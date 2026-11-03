const {modelConstants} = require('../constants');

const {
  buildMemberNameWhere,
  buildUserMembershipsSelect,
  CHECKLIST_ASSIGNMENT_ASSIGNER_SELECT,
  CHECKLIST_SUBMISSION_STATUSES,
  CHECKLIST_TEMPLATE_CASE_MANAGER_USAGE_SQL,
  CHECKLIST_TEMPLATE_PATIENT_USAGE_SQL,
  CHECKLIST_TEMPLATE_STATUSES,
  CHECKLIST_TEMPLATE_TYPES,
  CHECKLIST_TEMPLATE_USAGE_TABLES,
} = require('../constants/assessmentConstants');

const {
  FOLLOW_UP_TASK_STATUSES,
} = require('../constants/followUpTasksConstants');
const {AUTO_SUBMISSION_FLAG_REASON} = require('../constants/redFlagConstants');
const {RISK_SCORE_THRESHOLDS} = require('../constants/riskCalcConstants');

const {
  SUBMISSION_FLAG_STATUS,
  SUBMISSION_FLAG_TYPE,
} = require('../constants/submissionFlagConstants');

const {
  SUPERVISORY_VISIT_STATUSES,
} = require('../constants/supervisoryVisitsConstants');
const {PrismaFactory} = require('../factories');

const {
  withOrganizationMember,
  withProfileMember,
} = require('../factories/responses/workItems');

const {buildSectionsNestedCreate} = require('../utils/assessmentsUtils');

const {
  buildCaregiverPatientAccessClause,
} = require('../utils/checklistAssignmentUtils');

const {
  getDaysFromNow,
  getToday,
  getCurrentTime,
} = require('../utils/dateUtils');
const {buildNameSearchClause, safeMerge} = require('../utils/general');

const {
  buildNursePatientScopeClause,
} = require('../utils/nursePatientScopeUtils');
const {getExtraContext} = require('../utils/requestContext');

/**
 * Names are kept per organization: the assignee, the assigner and the
 * assignment's caregiver read as they are in the submission's organization.
 * Mutates and returns the submission; safe on a null one.
 */
const withSubmissionPeople = ({submission}) => {
  if (!submission) return submission;

  const {organizationId, assignment} = submission;

  if (submission.assignee) {
    submission.assignee = withOrganizationMember({
      user: submission.assignee,
      organizationId,
    });
  }

  if (assignment?.assigner) {
    assignment.assigner = withOrganizationMember({
      user: assignment.assigner,
      organizationId,
    });
  }

  if (assignment?.caregiverProfile) {
    assignment.caregiverProfile = withProfileMember({
      profile: assignment.caregiverProfile,
    });
  }

  return submission;
};

const withSubmissionPeopleResult = ({result}) => {
  if (result?.doc) withSubmissionPeople({submission: result.doc});

  (result?.docs || []).forEach((submission) =>
    withSubmissionPeople({submission})
  );

  return result;
};

module.exports = class AssessmentsServices {
  // ==========================================
  // CHECKLIST TEMPLATE METHODS
  // ==========================================

  static async getTemplateById({
    id,
    organizationId,
    caregiverProfileId,
    type,
    status,
    options = {},
    tx,
  }) {
    try {
      const query = {id};
      if (caregiverProfileId) {
        query.checklistAssignments = {
          some: {
            caregiverProfileId,
            isDeleted: null,
          },
        };
      }
      if (organizationId) query.organizationId = organizationId;
      if (type) query.type = type;
      if (status) query.status = status;

      return await PrismaFactory.findOne({
        model: modelConstants.MODELS.CHECKLIST_TEMPLATE,
        query,
        options,
        fieldsInclusion: options.fieldsInclusion,
        tx,
      });
    } catch (error) {
      return {success: false, doc: null, error};
    }
  }

  static async getTemplateByTitle({title, organizationId, excludeId}) {
    try {
      // Titles are unique per organization and the column is citext, so the
      // org filter is what keeps another tenant's title from blocking a create.
      const query = {title, organizationId};

      if (excludeId) {
        query.id = {not: excludeId};
      }

      return await PrismaFactory.findOne({
        model: modelConstants.MODELS.CHECKLIST_TEMPLATE,
        query,
      });
    } catch (error) {
      return {success: false, doc: null, error};
    }
  }

  static async createTemplate({
    title,
    description,
    sections,
    status,
    type,
    organizationId,
    createdBy,
    tx,
  }) {
    try {
      return await PrismaFactory.create({
        model: modelConstants.MODELS.CHECKLIST_TEMPLATE,
        data: {
          title,
          description,
          status,
          type,
          organizationId,
          createdBy,
          sections: {
            create: buildSectionsNestedCreate({sections, type}),
          },
        },
        tx,
      });
    } catch (error) {
      return {success: false, doc: null, error};
    }
  }

  // The current status is part of the WHERE, so two racing requests can't both
  // apply a transition; areDocumentsUpdated is false when the status moved on.
  static async transitionTemplateStatus({
    id,
    organizationId,
    fromStatus,
    toStatus,
    tx,
  }) {
    try {
      return await PrismaFactory.updateMany({
        model: modelConstants.MODELS.CHECKLIST_TEMPLATE,
        query: {id, organizationId, status: fromStatus},
        data: {status: toStatus},
        tx,
      });
    } catch (error) {
      return {success: false, areDocumentsUpdated: false, error};
    }
  }

  // Rewriting sections hard-deletes questions, which cascade to submission
  // answers. Safe only because drafts can't be used: every use requires ACTIVE.
  static async replaceDraftTemplateContent({
    id,
    organizationId,
    title,
    description,
    sections,
    type,
    tx,
  }) {
    try {
      const {
        success: isHeaderUpdated,
        error: headerError,
        areDocumentsUpdated: isDraft,
      } = await PrismaFactory.updateMany({
        model: modelConstants.MODELS.CHECKLIST_TEMPLATE,
        query: {
          id,
          organizationId,
          status: CHECKLIST_TEMPLATE_STATUSES.DRAFT.value,
        },
        data: {title, description},
        tx,
      });

      if (!isHeaderUpdated || !isDraft) {
        return {success: isHeaderUpdated, error: headerError, isDraft: false};
      }

      const {success, error} = await PrismaFactory.findOneAndUpdate({
        model: modelConstants.MODELS.CHECKLIST_TEMPLATE,
        query: {id},
        data: {
          sections: {
            deleteMany: {},
            create: buildSectionsNestedCreate({sections, type}),
          },
        },
        tx,
      });

      return {success, error, isDraft: true};
    } catch (error) {
      return {success: false, error, isDraft: false};
    }
  }

  static async deleteDraftTemplate({id, organizationId, tx}) {
    try {
      return await PrismaFactory.softDeleteOne({
        model: modelConstants.MODELS.CHECKLIST_TEMPLATE,
        query: {
          id,
          organizationId,
          status: CHECKLIST_TEMPLATE_STATUSES.DRAFT.value,
        },
        tx,
      });
    } catch (error) {
      return {success: false, isDocumentDeleted: false, error};
    }
  }

  // Patient templates count submissions and the red flags they raised; the
  // other types count the follow-up tasks or visits that use them.
  static async getTemplateUsage({id, organizationId, type}) {
    try {
      const query =
        type === CHECKLIST_TEMPLATE_TYPES.PATIENT.value
          ? CHECKLIST_TEMPLATE_PATIENT_USAGE_SQL({
              templateId: id,
              organizationId,
              countedSubmissionStatuses: [
                CHECKLIST_SUBMISSION_STATUSES.SUBMITTED.value,
                CHECKLIST_SUBMISSION_STATUSES.REVIEWED.value,
              ],
              autoFlagType: SUBMISSION_FLAG_TYPE.AUTO,
              redFlag: RISK_SCORE_THRESHOLDS.RED.flag,
              voidedFlagStatus: SUBMISSION_FLAG_STATUS.VOIDED,
            })
          : CHECKLIST_TEMPLATE_CASE_MANAGER_USAGE_SQL({
              tableName: CHECKLIST_TEMPLATE_USAGE_TABLES[type],
              templateId: id,
              organizationId,
              completedStatus:
                type === CHECKLIST_TEMPLATE_TYPES.FOLLOW_UP.value
                  ? FOLLOW_UP_TASK_STATUSES.completed.value
                  : SUPERVISORY_VISIT_STATUSES.approved.value,
            });

      const {success, error, docs} = await PrismaFactory.aggregate({query});

      return {success, error, doc: docs[0] || null};
    } catch (error) {
      return {success: false, doc: null, error};
    }
  }

  static async listTemplates({
    status,
    caregiverProfileId,
    type,
    search,
    skip = 0,
    take = 25,
    sort = null,
    options = {},
  }) {
    try {
      const query = {};
      if (status) query.status = status;
      if (type) query.type = type;
      if (caregiverProfileId) {
        query.checklistAssignments = {
          some: {
            caregiverProfileId,
            isDeleted: null,
          },
        };
      }

      const searchClause = buildNameSearchClause({
        name: search,
        fields: ['title'],
      });
      if (searchClause) Object.assign(query, searchClause);

      const queryOptions = safeMerge({
        originalObj: {skip, take},
        newObj: sort ? {sort} : {},
      });

      const result = await PrismaFactory.find({
        model: modelConstants.MODELS.CHECKLIST_TEMPLATE,
        query,
        options: safeMerge({originalObj: options, newObj: queryOptions}),
        fieldsInclusion: options.fieldsInclusion,
      });

      const countResult = await PrismaFactory.countDocuments({
        model: modelConstants.MODELS.CHECKLIST_TEMPLATE,
        query,
      });

      return safeMerge({
        originalObj: result,
        newObj: {count: countResult.success ? countResult.count : 0},
      });
    } catch (error) {
      return {success: false, docs: [], error, count: 0};
    }
  }

  // ==========================================
  // CHECKLIST SUBMISSION METHODS
  // ==========================================

  static async getSubmissionById({id, assigneeId, statuses, options = {}}) {
    try {
      const query = {id};
      if (assigneeId) query.assigneeId = assigneeId;
      if (statuses) query.status = {in: statuses};

      const result = await PrismaFactory.findOne({
        model: modelConstants.MODELS.CHECKLIST_SUBMISSION,
        query,
        options,
        fieldsInclusion: options.fieldsInclusion,
      });

      return withSubmissionPeopleResult({result});
    } catch (error) {
      return {success: false, doc: null, error};
    }
  }

  static async getSubmissionDetails({
    id,
    assigneeId,
    caregiverUserId,
    nurseScope,
    caseManagerProfileId,
    visibilityClause,
  }) {
    try {
      const query = {id};
      if (assigneeId) query.assigneeId = assigneeId;
      if (visibilityClause) query.AND = [visibilityClause];
      if (caregiverUserId) {
        query.patient = buildCaregiverPatientAccessClause({
          userId: caregiverUserId,
        });
      }
      if (nurseScope) {
        query.patient = buildNursePatientScopeClause({nurseScope});
      }
      if (caseManagerProfileId) {
        query.patient = {
          caseManagerPatients: {some: {caseManagerProfileId}},
        };
      }

      const result = await PrismaFactory.findOne({
        model: modelConstants.MODELS.CHECKLIST_SUBMISSION,
        query,

        // Detail view is read-only; allow viewing submissions of archived patients
        // (submissions are cascade-soft-deleted with their patient)
        options: {includeDeleted: true},
        fieldsInclusion: {
          include: {
            patient: {
              select: {
                firstName: true,
                lastName: true,
                email: true,
                address: true,
                phoneNo: true,
                dateOfBirth: true,
                gender: true,
                county: {
                  select: {
                    id: true,
                    name: true,
                    region: {select: {id: true, name: true}},
                  },
                },
              },
            },
            assignee: {
              select: {
                email: true,
                userOrganizations: buildUserMembershipsSelect({
                  fields: ['firstName', 'lastName', 'address', 'phoneNo'],
                }),
              },
            },
            assignment: {
              select: {
                notes: true,
                type: true,
                assigner: CHECKLIST_ASSIGNMENT_ASSIGNER_SELECT,
              },
            },
          },
        },
      });

      return withSubmissionPeopleResult({result});
    } catch (error) {
      return {success: false, doc: null, error};
    }
  }

  static async updateSubmission({
    id,
    visitNotes,
    answers,
    status,
    submittedAt,
    tx,
  }) {
    try {
      const data = {
        visitNotes,
        answers: {
          deleteMany: {},
          create: answers.map((answer) => ({
            questionId: answer.questionId,
            value: answer.value !== undefined ? answer.value : null,
            comment: answer.comment || null,
            images: answer.images || [],
          })),
        },
      };

      if (status) data.status = status;
      if (submittedAt) data.submittedAt = submittedAt;

      return await PrismaFactory.updateOne({
        model: modelConstants.MODELS.CHECKLIST_SUBMISSION,
        query: {id},
        data,
        tx,
      });
    } catch (error) {
      return {success: false, doc: null, error};
    }
  }

  static async voidSubmission({id, voidReason, tx}) {
    try {
      return await PrismaFactory.updateOne({
        model: modelConstants.MODELS.CHECKLIST_SUBMISSION,
        query: {id, voidedAt: null},
        data: {
          status: CHECKLIST_SUBMISSION_STATUSES.VOIDED.value,
          voidReason,
          voidedAt: getCurrentTime(),
        },
        tx,
      });
    } catch (error) {
      return {success: false, doc: null, error};
    }
  }

  static async deleteSubmissionsByAssignment({assignmentId, statuses, tx}) {
    try {
      return await PrismaFactory.softDeleteMany({
        model: modelConstants.MODELS.CHECKLIST_SUBMISSION,
        query: {assignmentId, status: {in: statuses}, isDeleted: null},
        tx,
      });
    } catch (error) {
      return {success: false, error};
    }
  }

  static async deleteSubmissionsByPatient({patientId, statuses, tx}) {
    try {
      return await PrismaFactory.softDeleteMany({
        model: modelConstants.MODELS.CHECKLIST_SUBMISSION,
        query: {patientId, status: {in: statuses}, isDeleted: null},
        tx,
      });
    } catch (error) {
      return {success: false, error};
    }
  }

  static async skipSubmission({id, reason, tx}) {
    try {
      return await PrismaFactory.updateOne({
        model: modelConstants.MODELS.CHECKLIST_SUBMISSION,
        query: {id},
        data: {
          status: CHECKLIST_SUBMISSION_STATUSES.SKIPPED.value,
          skipReason: reason,
        },
        tx,
      });
    } catch (error) {
      return {success: false, doc: null, error};
    }
  }

  static async upsertSubmissionRisk({
    submissionId,
    patientId,
    organizationId,
    submittedBy,
    riskResult,
    tx,
  }) {
    try {
      const {flag, riskScore, riskCategory} = riskResult;

      const {doc: existing} = await PrismaFactory.findOne({
        model: modelConstants.MODELS.SUBMISSION_FLAG,
        query: {submissionId, type: SUBMISSION_FLAG_TYPE.AUTO},
        options: {bypassExtraQueries: true},
        tx,
      });

      if (existing) {
        const {success, error, responseObj} = await PrismaFactory.updateOne({
          model: modelConstants.MODELS.SUBMISSION_FLAG,
          query: {id: existing.id},
          data: {flag, category: riskCategory, score: riskScore},
          options: {bypassExtraQueries: true},
          tx,
        });

        return {success, error, doc: responseObj || existing};
      }

      return await PrismaFactory.create({
        model: modelConstants.MODELS.SUBMISSION_FLAG,
        data: {
          submissionId,
          patientId,
          organizationId,
          submittedBy,
          flag,
          category: riskCategory,
          score: riskScore,
          type: SUBMISSION_FLAG_TYPE.AUTO,
          reason: AUTO_SUBMISSION_FLAG_REASON,
          description:
            'Auto-generated from checklist submission risk calculation',
        },
        tx,
      });
    } catch (error) {
      return {success: false, doc: null, error};
    }
  }

  static async listSubmissions({
    status,
    patientId,
    assigneeId,
    caregiverUserId,
    nurseScope,
    caseManagerProfileId,
    visibilityClause,
    search,
    skip = 0,
    take = 25,
    sort = null,
    includeDeleted = false,
    options = {},
  }) {
    try {
      const query = {};

      if (Array.isArray(status) && status.length > 0) {
        query.status = {in: status};
      }
      if (patientId) {
        query.patientId = patientId;
      }
      if (assigneeId) {
        query.assigneeId = assigneeId;
      }
      if (caregiverUserId) {
        query.patient = buildCaregiverPatientAccessClause({
          userId: caregiverUserId,
        });
      }
      if (nurseScope) {
        query.patient = buildNursePatientScopeClause({nurseScope});
      }
      if (caseManagerProfileId) {
        query.patient = {
          caseManagerPatients: {some: {caseManagerProfileId}},
        };
      }

      const nameClause = buildNameSearchClause({
        name: search,
        fields: ['patient.firstName', 'patient.lastName'],
      });
      if (nameClause) {
        // The assignee is searched by the name they have in this
        // organization, not by another organization's. The clause has one
        // entry per word, in order.
        const organizationId = getExtraContext().queries?.organizationId;
        const tokens = search.trim().split(/\s+/);

        nameClause.AND.forEach((tokenClause, index) => {
          tokenClause.OR.push({
            assignee: buildMemberNameWhere({
              token: tokens[index],
              organizationId,
            }),
          });
        });
        Object.assign(query, nameClause);
      }

      // Joined to the search's own AND, so a search can't drop it.
      if (visibilityClause) {
        query.AND = [visibilityClause].concat(query.AND || []);
      }

      const effectiveSort = sort ?? {updatedAt: 'desc'};

      const queryOptions = safeMerge({
        originalObj: {skip, take},
        newObj: {sort: effectiveSort, includeDeleted},
      });

      const result = await PrismaFactory.find({
        model: modelConstants.MODELS.CHECKLIST_SUBMISSION,
        query,
        options: safeMerge({originalObj: options, newObj: queryOptions}),
        fieldsInclusion: options.fieldsInclusion,
      });

      const countResult = await PrismaFactory.countDocuments({
        model: modelConstants.MODELS.CHECKLIST_SUBMISSION,
        query,
        options: {includeDeleted},
      });

      withSubmissionPeopleResult({result});

      return safeMerge({
        originalObj: result,
        newObj: {count: countResult.success ? countResult.count : 0},
      });
    } catch (error) {
      return {success: false, docs: [], error, count: 0};
    }
  }

  static async listPatientUpcomingAssessments({
    patientId,
    caregiverProfileId,
    caseManagerProfileId,
  }) {
    try {
      const today = getToday();

      const sevenDaysFromNow = getDaysFromNow({days: 7});

      const query = {
        patientId,
        status: {
          in: [
            CHECKLIST_SUBMISSION_STATUSES.PENDING.value,
            CHECKLIST_SUBMISSION_STATUSES.LATE.value,
            CHECKLIST_SUBMISSION_STATUSES.UPCOMING.value,
          ],
        },
        deadline: {gte: today, lte: sevenDaysFromNow},
      };

      if (caregiverProfileId) {
        query.assignment = {caregiverProfileId, isDeleted: null};
      }

      if (caseManagerProfileId) {
        query.patient = {
          caseManagerPatients: {some: {caseManagerProfileId}},
        };
      }

      const result = await PrismaFactory.find({
        model: modelConstants.MODELS.CHECKLIST_SUBMISSION,
        query,
        options: {
          sort: {deadline: 'asc'},
        },
      });

      return withSubmissionPeopleResult({result});
    } catch (error) {
      return {success: false, docs: [], error};
    }
  }

  static async getCaregiverPatientAssignment({
    caregiverProfileId,
    patientId,
    options = {},
  }) {
    try {
      return await PrismaFactory.findOne({
        model: modelConstants.MODELS.CAREGIVER_PATIENT,
        query: {caregiverProfileId, patientId},
        options,
      });
    } catch (error) {
      return {success: false, doc: null, error};
    }
  }
};
