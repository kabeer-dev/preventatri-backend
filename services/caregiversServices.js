const {modelConstants} = require('../constants');

const {
  CHECKLIST_SUBMISSION_STATUSES,
} = require('../constants/assessmentConstants');

const {CAREGIVER_STATUSES} = require('../constants/caregiversConstants');
const {RISK_SCORE_THRESHOLDS} = require('../constants/riskCalcConstants');

const {
  SUBMISSION_FLAG_STATUS,
} = require('../constants/submissionFlagConstants');
const {PrismaFactory} = require('../factories');
const {buildDateRangeClause} = require('../utils/dateUtils');

const {
  buildNameSearchClause,
  filterUndefined,
  safeMerge,
} = require('../utils/general');
const {getExtraContext} = require('../utils/requestContext');

module.exports = class CaregiversServices {
  /**
   * Get caregiver profile by ID
   */
  static async getCaregiverProfileById({id, options = {}}) {
    try {
      const result = await PrismaFactory.findOne({
        model: modelConstants.MODELS.CAREGIVER_PROFILE,
        query: {id},
        options,
        fieldsInclusion: options.fieldsInclusion,
      });

      return result;
    } catch (error) {
      return {success: false, doc: null, error};
    }
  }

  static async getCaregiverProfileByUser({userId, additionalFilters} = {}) {
    try {
      return await PrismaFactory.findOne({
        model: modelConstants.MODELS.CAREGIVER_PROFILE,
        query: Object.assign({userId}, additionalFilters),
      });
    } catch (error) {
      return {success: false, doc: null, error};
    }
  }

  /**
   * Create caregiver profile
   */
  static async createCaregiverProfile({
    userId,
    organizationId,
    role,
    status = CAREGIVER_STATUSES.ACTIVE.value,
    relationshipToPatient,
    preferredContactMethod,
    language,
    notes,
    startDate,
    terminationDate,
    onCallIndicator,

    // HHAeXchange provenance. Only the sync engine passes these; the invite
    // flow leaves them undefined and filterUndefined drops them, so the row
    // keeps the MANUAL default and a NULL hhaCaregiverId -- which is exactly
    // what caregiver_profiles_hha_identity_check requires.
    source,
    hhaCaregiverId,
    hhaSyncHash,
    hhaLastSyncedAt,
    hhaModifiedDate,
    tx,
  }) {
    try {
      const data = filterUndefined({
        obj: {
          userId,
          organizationId,
          role,
          status,
          relationshipToPatient,
          preferredContactMethod,
          language,
          notes,
          startDate,
          terminationDate,
          onCallIndicator,
          source,
          hhaCaregiverId,
          hhaSyncHash,
          hhaLastSyncedAt,
          hhaModifiedDate,
        },
      });

      const {success, doc, error} = await PrismaFactory.create({
        model: modelConstants.MODELS.CAREGIVER_PROFILE,
        data,
        tx,
      });

      return {success, doc, error};
    } catch (error) {
      return {success: false, doc: null, error};
    }
  }

  /**
   * Update caregiver profile
   */
  static async updateCaregiverProfile({id, updateData, tx}) {
    try {
      const {success, doc, error} = await PrismaFactory.updateOne({
        model: modelConstants.MODELS.CAREGIVER_PROFILE,
        query: {id},
        data: updateData,
        tx,
      });

      return {success, doc, error};
    } catch (error) {
      return {success: false, doc: null, error};
    }
  }

  /**
   * Soft delete caregiver profile
   */
  static async deleteCaregiverProfile({id, tx}) {
    try {
      const {success, doc, error} = await PrismaFactory.softDeleteOne({
        model: modelConstants.MODELS.CAREGIVER_PROFILE,
        query: {id},
        tx,
      });

      return {success, doc, error};
    } catch (error) {
      return {success: false, doc: null, error};
    }
  }

  /**
   * List caregiver profiles with filters
   */
  static async listCaregiverProfiles({
    status,
    role,
    name,
    skip = 0,
    take = 25,
    sort = null,
    options = {},
  }) {
    try {
      const query = {};

      if (status && status !== 'all') {
        query.status = status;
      }

      if (role && role !== 'all') {
        query.role = role;
      }

      const nameClause = buildNameSearchClause({
        name,
        fields: ['user.firstName', 'user.lastName'],
      });
      if (nameClause) {
        Object.assign(query, nameClause);
      }

      const queryOptions = safeMerge({
        originalObj: {skip, take},
        newObj: sort ? {sort} : {},
      });

      const result = await PrismaFactory.find({
        model: modelConstants.MODELS.CAREGIVER_PROFILE,
        query,
        options: safeMerge({originalObj: options, newObj: queryOptions}),
        fieldsInclusion: safeMerge({
          originalObj: options.fieldsInclusion || {},
          newObj: {
            include: {
              checklistAssignments: {
                select: {patientId: true},
                where: {isDeleted: null, patient: {isDeleted: null}},
              },
              user: {
                select: {
                  id: true,
                  firstName: true,
                  lastName: true,
                  email: true,
                  phoneNo: true,

                  // Documented on the shared user response schema -- the
                  // caregiver address lives on the user row.
                  address: true,
                  city: true,
                  state: true,
                  zipCode: true,
                  isVerified: true,
                  _count: {
                    select: {
                      submissionFlags: {
                        where: {
                          isDeleted: null,
                          flag: RISK_SCORE_THRESHOLDS.RED.flag,
                          status: {not: SUBMISSION_FLAG_STATUS.VOIDED},
                          organizationId:
                            getExtraContext().queries?.organizationId,
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        }),
      });

      const countResult = await PrismaFactory.countDocuments({
        model: modelConstants.MODELS.CAREGIVER_PROFILE,
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

  /**
   * Validate that caregiver profile IDs exist
   */
  static async validateCaregiverProfileIds({caregiverProfileIds}) {
    try {
      const {
        success,
        docs: profiles,
        error,
      } = await PrismaFactory.find({
        model: modelConstants.MODELS.CAREGIVER_PROFILE,
        query: {id: {in: caregiverProfileIds}},
      });

      if (!success)
        return {valid: false, invalidIds: caregiverProfileIds, error};

      const validIds = new Set(profiles.map((p) => p.id));
      const invalidIds = caregiverProfileIds.filter((id) => !validIds.has(id));

      return {valid: invalidIds.length === 0, invalidIds};
    } catch (error) {
      return {valid: false, invalidIds: caregiverProfileIds, error};
    }
  }

  // ==========================================
  // CAREGIVER-PATIENT ASSIGNMENT METHODS
  // ==========================================

  /**
   * Shared: replace all CaregiverPatient rows matching deleteQuery, then create new ones
   * Used by both assignPatientsToCaregiver and PatientsServices.assignCaregiversToPatient
   */
  static async assignCaregiverPatients({deleteQuery, assignments, tx}) {
    try {
      await PrismaFactory.hardDeleteMany({
        model: modelConstants.MODELS.CAREGIVER_PATIENT,
        query: deleteQuery,
        tx,
      });

      const results = [];
      for (const assignment of assignments) {
        const {doc} = await PrismaFactory.create({
          model: modelConstants.MODELS.CAREGIVER_PATIENT,
          data: assignment,
          tx,
        });
        results.push(doc);
      }

      return {success: true, docs: results, error: null};
    } catch (error) {
      return {success: false, docs: [], error};
    }
  }

  /**
   * Assign patients to a caregiver (replaces all existing assignments)
   */
  static async assignPatientsToCaregiver({
    caregiverProfileId,
    patientIds,
    organizationId,
    tx,
  }) {
    return this.assignCaregiverPatients({
      deleteQuery: {caregiverProfileId},
      assignments: patientIds.map((patientId) => ({
        caregiverProfileId,
        patientId,
        organizationId,
      })),
      tx,
    });
  }

  // Dashboard stats scoped to the *logged-in caregiver* (not org-wide): the
  // patients assigned to them, their assessments due vs completed, the flags
  // they have submitted, and the follow-up tasks open on their patients.
  static async getCaregiverStats({userId, organizationId, from, to}) {
    try {
      // Everything is keyed off the logged-in caller's token: submissions
      // (assigneeId) and flags (submittedBy) are keyed by User.id directly,
      // while assignment-based metrics are filtered through the
      // CaregiverProfile relation by userId — so we never need to look the
      // profile id up first. A caller with no caregiver profile simply matches
      // nothing and gets 0.
      const ownCaregiverProfile = {userId, isDeleted: null};

      // Optional date range applied per metric on its own date column. Absent
      // bounds are dropped, so an empty range leaves the metric all-time.
      const dateClause = ({field}) => buildDateRangeClause({from, to, field});

      // Submissions waiting on the caregiver vs already finished.
      const dueStatuses = [
        CHECKLIST_SUBMISSION_STATUSES.UPCOMING.value,
        CHECKLIST_SUBMISSION_STATUSES.PENDING.value,
        CHECKLIST_SUBMISSION_STATUSES.LATE.value,
      ];

      const completedStatuses = [
        CHECKLIST_SUBMISSION_STATUSES.SUBMITTED.value,
        CHECKLIST_SUBMISSION_STATUSES.REVIEWED.value,
      ];

      // A patient "belongs" to a caregiver through an active checklist
      // assignment — the same relation the caregiver patient-list endpoint
      // filters on — so the dashboard count always matches the list they see.
      // (caregiver_patients is a parallel assignment table the current
      // assignment flow does not populate.)
      const ownActiveAssignment = {
        caregiverProfile: ownCaregiverProfile,
        isDeleted: null,
      };

      // Each metric maps to exactly one count query, all scoped to the caller.
      const countSpecs = {
        assignedPatients: {
          model: modelConstants.MODELS.PATIENT,
          query: {
            organizationId,
            isDeleted: null,
            checklistAssignments: {
              some: Object.assign(
                {},
                ownActiveAssignment,
                dateClause({field: 'createdAt'})
              ),
            },
          },
        },
        assessmentsDue: {
          model: modelConstants.MODELS.CHECKLIST_SUBMISSION,
          query: Object.assign(
            {
              organizationId,
              isDeleted: null,
              assigneeId: userId,
              status: {in: dueStatuses},
            },
            dateClause({field: 'dueDate'})
          ),
        },
        assessmentsCompleted: {
          model: modelConstants.MODELS.CHECKLIST_SUBMISSION,
          query: Object.assign(
            {
              organizationId,
              isDeleted: null,
              assigneeId: userId,
              status: {in: completedStatuses},
            },
            dateClause({field: 'submittedAt'})
          ),
        },
        submittedFlags: {
          model: modelConstants.MODELS.SUBMISSION_FLAG,
          query: Object.assign(
            {organizationId, isDeleted: null, submittedBy: userId},
            dateClause({field: 'createdAt'})
          ),
        },

        // Follow-up tasks are case-manager-owned; for the caregiver dashboard
        // we surface the pending ones on patients assigned to this caregiver.
        // followUpTasks: {
        //   model: modelConstants.MODELS.FOLLOW_UP_TASK,
        //   query: Object.assign(
        //     {
        //       organizationId,
        //       isDeleted: null,
        //       status: FOLLOW_UP_TASK_STATUSES.pending.value,
        //       patient: {
        //         checklistAssignments: {some: ownActiveAssignment},
        //       },
        //     },
        //     dateClause({field: 'dueDate'})
        //   ),
        // },
      };

      const metrics = Object.keys(countSpecs);

      const results = await Promise.all(
        metrics.map((metric) =>
          PrismaFactory.countDocuments(countSpecs[metric])
        )
      );

      const failed = results.find(({success}) => !success);
      if (failed) return {success: false, doc: null, error: failed.error};

      const doc = Object.fromEntries(
        metrics.map((metric, index) => [metric, results[index].count])
      );

      return {success: true, doc};
    } catch (error) {
      return {success: false, doc: null, error};
    }
  }

  // Org-wide caregiver stats for the admin dashboard: total caregivers plus
  // the active/inactive split. The optional from/to window applies to
  // createdAt and defaults to all time.
  static async getCaregiverAdminStats({organizationId, from, to}) {
    try {
      const dateClause = buildDateRangeClause({from, to});

      const caregiverBaseQuery = {organizationId, isDeleted: null};

      // One count per CaregiverStatus, derived from the constant rather than
      // hand-listed: the enum grew from two members to six when the
      // HHAeXchange import landed, and a hard-coded active/inactive pair would
      // silently drop the four new buckets from the admin cards. Adding a
      // seventh status is a constant entry and nothing here.
      const countSpecs = Object.values(CAREGIVER_STATUSES).reduce(
        (specs, status) => {
          specs[status.statsKey] = {
            model: modelConstants.MODELS.CAREGIVER_PROFILE,
            query: Object.assign(
              {},
              caregiverBaseQuery,
              {status: status.value},
              dateClause
            ),
          };

          return specs;
        },
        {
          totalCaregivers: {
            model: modelConstants.MODELS.CAREGIVER_PROFILE,
            query: Object.assign({}, caregiverBaseQuery, dateClause),
          },
        }
      );

      const metrics = Object.keys(countSpecs);

      const results = await Promise.all(
        metrics.map((metric) =>
          PrismaFactory.countDocuments(countSpecs[metric])
        )
      );

      const failed = results.find(({success}) => !success);
      if (failed) return {success: false, doc: null, error: failed.error};

      const doc = Object.fromEntries(
        metrics.map((metric, index) => [metric, results[index].count])
      );

      return {success: true, doc};
    } catch (error) {
      return {success: false, doc: null, error};
    }
  }

  /**
   * Get caregiver's assigned patients
   */
  static async getCaregiverPatients({caregiverProfileId}) {
    try {
      const result = await PrismaFactory.find({
        model: modelConstants.MODELS.CAREGIVER_PATIENT,
        query: {caregiverProfileId},
        fieldsInclusion: {
          include: {
            patient: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                status: true,
                dateOfBirth: true,
                county: {select: {id: true, name: true}},
              },
            },
          },
        },
      });

      return result;
    } catch (error) {
      return {success: false, docs: [], error};
    }
  }

  /**
   * Resolve the underlying user ids of every caregiver currently assigned to a
   * patient. Caregivers are linked to patients through (non-deleted) checklist
   * assignments — NOT the CaregiverPatient table — so we read ChecklistAssignment
   * and hop caregiverProfile → user. Works from a request or a background worker;
   * used to notify a patient's caregivers (e.g. on flag resolution). Returns
   * de-duplicated user ids.
   *
   * @returns {Promise<{success, userIds, error}>}
   */
  static async getPatientCaregiverUserIds({patientId, organizationId}) {
    try {
      const {success, docs, error} = await PrismaFactory.find({
        model: modelConstants.MODELS.CHECKLIST_ASSIGNMENT,
        query: {
          patientId,
          organizationId,
          isDeleted: null,
          caregiverProfile: {status: CAREGIVER_STATUSES.ACTIVE.value},
        },
        fieldsInclusion: {
          include: {
            caregiverProfile: {select: {user: {select: {id: true}}}},
          },
        },
        options: {bypassExtraQueries: true},
      });

      if (!success) {
        return {success: false, userIds: [], error};
      }

      const userIds = Array.from(
        new Set(
          (docs || [])
            .map((assignment) => assignment.caregiverProfile?.user?.id)
            .filter(Boolean)
        )
      );

      return {success: true, userIds};
    } catch (error) {
      return {success: false, userIds: [], error};
    }
  }
};
