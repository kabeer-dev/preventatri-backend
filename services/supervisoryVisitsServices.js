const {modelConstants} = require('../constants');

const {
  buildUserMembershipsSelect,
} = require('../constants/assessmentConstants');

const {
  SUPERVISORY_VISIT_STATUSES,
  SUPERVISORY_VISIT_OPEN_STATUS_VALUES,
  SUPERVISORY_VISIT_SWEEPABLE_STATUS_VALUES,
  SUPERVISORY_VISIT_CANCELLABLE_STATUS_VALUES,
  SUPERVISORY_VISIT_REVIEWABLE_STATUS_VALUES,
  SUPERVISORY_VISIT_COMPLETION_SOURCES,
  SUPERVISORY_VISIT_SOURCES,
  SUPERVISORY_VISIT_EVENT_TYPES,
  SUPERVISORY_VISIT_DEFAULT_SORT,
  SUPERVISORY_VISIT_SCHEDULE_SORT,
} = require('../constants/supervisoryVisitsConstants');

const {WORK_ITEM_EVENTS_LIMIT} = require('../constants/workItemConstants');
const {PrismaFactory} = require('../factories');
const {withWorkItemPeople} = require('../factories/responses/workItems');

const {
  addMinutes,
  getCurrentTime,
  getDayRangeInZone,
} = require('../utils/dateUtils');

const {buildNameSearchClause, safeMerge} = require('../utils/general');

const {wrapWithPrismaTransaction} = require('../utils/prismaTransactionUtils');
const {recordVisitEvent} = require('../utils/supervisoryVisitEventUtils');

const {MODELS} = modelConstants;

// Names are kept per organization: a plain user brings their memberships (read
// down to the visit's organization by withWorkItemPeople), an assignee or
// caregiver is a membership and carries the name itself.
const PERSON_SELECT = {
  id: true,
  email: true,
  userOrganizations: buildUserMembershipsSelect({
    fields: ['firstName', 'lastName'],
  }),
};

const USER_ORG_SELECT = {
  id: true,
  role: true,
  firstName: true,
  lastName: true,
  user: {select: {id: true, email: true}},
};

const FLAG_SELECT = {
  id: true,
  flag: true,
  category: true,
  reason: true,
  description: true,
  status: true,
  createdAt: true,
};

const EVENT_SELECT = {
  id: true,
  type: true,
  actorType: true,
  actorUserId: true,
  fromStatus: true,
  toStatus: true,
  fromAssigneeUserOrganizationId: true,
  toAssigneeUserOrganizationId: true,
  payload: true,
  createdAt: true,
  actor: {select: PERSON_SELECT},
  fromAssignee: {select: USER_ORG_SELECT},
  toAssignee: {select: USER_ORG_SELECT},
};

const CAREGIVER_SELECT = {
  userOrganizationId: true,
  userOrg: {select: USER_ORG_SELECT},
};

const LINKED_TASK_SELECT = {
  id: true,
  title: true,
  status: true,
  priority: true,
  dueAt: true,
  assignee: {select: USER_ORG_SELECT},
};

const CAREGIVERS_INCLUDE = {caregivers: {select: CAREGIVER_SELECT}};

const DETAILS_INCLUDE = {
  caregivers: {select: CAREGIVER_SELECT},
  checklistTemplate: {
    include: {
      sections: {
        orderBy: {sortOrder: 'asc'},
        include: {questions: {orderBy: {sortOrder: 'asc'}}},
      },
    },
  },
  submissionFlag: {select: FLAG_SELECT},
  createdByUser: {select: PERSON_SELECT},
  completedByUser: {select: PERSON_SELECT},
  reviewedByUser: {select: PERSON_SELECT},
  cancelledByUser: {select: PERSON_SELECT},
  followUpTasks: {
    where: {isDeleted: null},
    orderBy: {dueAt: 'asc'},
    select: LINKED_TASK_SELECT,
  },
  events: {
    orderBy: {createdAt: 'desc'},
    take: WORK_ITEM_EVENTS_LIMIT,
    select: EVENT_SELECT,
  },
};

// Fields the list never needs (large JSON) -- details fetch them.
const LIST_EXCLUDE = ['answers'];

const SEARCH_FIELDS = [
  'patient.firstName',
  'patient.lastName',
  'assignee.firstName',
  'assignee.lastName',
];

const toStatusList = ({status}) =>
  (Array.isArray(status) ? status : String(status).split(','))
    .map((value) => value.trim())
    .filter(Boolean);

const toCaregiverRows = ({caregiverUserOrganizationIds}) =>
  Array.from(new Set(caregiverUserOrganizationIds || [])).map(
    (userOrganizationId) => ({userOrganizationId})
  );

module.exports = class SupervisoryVisitsServices {
  // The status an open visit returns to after a correction request or a
  // reschedule: OVERDUE once its window has passed, else SCHEDULED.
  static resolveResumedStatus({scheduledEndAt}) {
    if (new Date(scheduledEndAt) < getCurrentTime())
      return SUPERVISORY_VISIT_STATUSES.overdue.value;

    return SUPERVISORY_VISIT_STATUSES.scheduled.value;
  }

  /**
   * Create a visit, its caregivers and its CREATED event atomically. Uses the
   * caller's `tx` when given (escalation resolve) or opens one.
   */
  static async createVisit({
    organizationId,
    patientId,
    assigneeUserOrganizationId,
    checklistTemplateId,
    visitType,
    visitTypeOther,
    description,
    scheduledStartAt,
    scheduledEndAt,
    submissionFlagId,
    caregiverUserOrganizationIds,
    flagType,
    createdBy,
    tx,
  }) {
    const caregiverRows = toCaregiverRows({caregiverUserOrganizationIds});

    const persist = async ({tx: txClient}) => {
      const {success, doc, error} = await PrismaFactory.create({
        model: MODELS.SUPERVISORY_VISIT,
        data: {
          organizationId,
          patientId,
          assigneeUserOrganizationId,
          checklistTemplateId,
          visitType,
          visitTypeOther: visitTypeOther || null,
          description: description || null,
          scheduledStartAt,
          scheduledEndAt,
          submissionFlagId: submissionFlagId || null,
          flagType: flagType !== undefined ? flagType : null,
          createdBy,
          caregivers: {create: caregiverRows},
        },
        options: {bypassExtraQueries: true},
        tx: txClient,
      });

      if (!success) {
        throw error instanceof Error
          ? error
          : new Error(error?.message || 'Failed to create supervisory visit');
      }

      await recordVisitEvent({
        tx: txClient,
        visit: doc,
        type: SUPERVISORY_VISIT_EVENT_TYPES.created.value,
        actorUserId: createdBy,
        toStatus: doc.status,
        toAssigneeUserOrganizationId: assigneeUserOrganizationId,
        payload: {
          source: submissionFlagId
            ? SUPERVISORY_VISIT_SOURCES.alert.value
            : SUPERVISORY_VISIT_SOURCES.standalone.value,
          caregiverUserOrganizationIds: caregiverRows.map(
            (row) => row.userOrganizationId
          ),
        },
      });

      return doc;
    };

    try {
      const doc = tx
        ? await persist({tx})
        : await wrapWithPrismaTransaction({
            fn: (txClient) => persist({tx: txClient}),
          });

      return {success: true, doc};
    } catch (error) {
      return {success: false, doc: null, error};
    }
  }

  static async getVisitById({id, scopeClause = {}, include = {}, tx}) {
    try {
      return await PrismaFactory.findOne({
        model: MODELS.SUPERVISORY_VISIT,
        query: Object.assign({id}, scopeClause),
        fieldsInclusion: {include},
        tx,
      });
    } catch (error) {
      return {success: false, doc: null, error};
    }
  }

  static async getVisitDetails({id, scopeClause = {}}) {
    try {
      const result = await PrismaFactory.findOne({
        model: MODELS.SUPERVISORY_VISIT,
        query: Object.assign({id}, scopeClause),
        fieldsInclusion: {include: DETAILS_INCLUDE},
      });

      return Object.assign(result, {
        doc: withWorkItemPeople({item: result.doc}),
      });
    } catch (error) {
      return {success: false, doc: null, error};
    }
  }

  static async listVisits({
    scopeClause = {},
    patientId,
    assigneeUserId,
    assigneeUserOrganizationId,
    status,
    visitType,
    regionId,
    search,
    scheduledFrom,
    scheduledTo,
    skip = 0,
    take = 25,
    sort = null,
    options = {},
  }) {
    try {
      const query = {};

      if (patientId) query.patientId = patientId;
      if (assigneeUserOrganizationId)
        query.assigneeUserOrganizationId = assigneeUserOrganizationId;
      if (assigneeUserId) query.assignee = {userId: assigneeUserId};
      if (visitType) query.visitType = visitType;
      if (regionId) query.patient = {county: {regionId}};

      if (status) {
        const statuses = toStatusList({status});
        if (statuses.length) query.status = {in: statuses};
      }

      if (scheduledFrom || scheduledTo) {
        query.scheduledStartAt = Object.assign(
          {},
          scheduledFrom ? {gte: scheduledFrom} : {},
          scheduledTo ? {lte: scheduledTo} : {}
        );
      }

      // Scope and search both produce OR/AND trees; AND them together so
      // neither overwrites the other.
      const andClauses = [
        scopeClause,
        buildNameSearchClause({name: search, fields: SEARCH_FIELDS}),
      ].filter((clause) => clause && Object.keys(clause).length > 0);

      if (andClauses.length) query.AND = andClauses;

      const queryOptions = safeMerge({
        originalObj: {skip, take},
        newObj: {sort: sort ?? SUPERVISORY_VISIT_DEFAULT_SORT},
      });

      const result = await PrismaFactory.find({
        model: MODELS.SUPERVISORY_VISIT,
        query,
        options: safeMerge({originalObj: options, newObj: queryOptions}),
        fieldsInclusion: safeMerge({
          originalObj: options.fieldsInclusion || {},
          newObj: {
            exclude: LIST_EXCLUDE,
            include: {
              submissionFlag: {select: FLAG_SELECT},
              _count: {select: {caregivers: true}},
            },
          },
        }),
      });

      const countResult = await PrismaFactory.countDocuments({
        model: MODELS.SUPERVISORY_VISIT,
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

  // Soft duplicate guard: same patient, assignee and start while open.
  static async getVisitByUniqueKey({
    patientId,
    assigneeUserOrganizationId,
    scheduledStartAt,
  }) {
    try {
      return await PrismaFactory.findOne({
        model: MODELS.SUPERVISORY_VISIT,
        query: {
          patientId,
          assigneeUserOrganizationId,
          scheduledStartAt,
          status: {in: SUPERVISORY_VISIT_OPEN_STATUS_VALUES},
        },
      });
    } catch (error) {
      return {success: false, doc: null, error};
    }
  }

  /**
   * CAS state change: only a row still in one of `fromStatuses` is updated.
   * `updated: false` means someone else transitioned it first.
   */
  static async transitionVisit({id, fromStatuses, data, tx}) {
    const {success, error, areDocumentsUpdated} =
      await PrismaFactory.updateMany({
        model: MODELS.SUPERVISORY_VISIT,
        query: {id, status: {in: fromStatuses}},
        data,
        options: {bypassExtraQueries: true},
        tx,
      });

    if (!success) {
      throw error instanceof Error
        ? error
        : new Error(error?.message || 'Failed to update supervisory visit');
    }

    return {updated: Boolean(areDocumentsUpdated)};
  }

  static updateVisit({id, data, tx}) {
    return this.transitionVisit({
      id,
      fromStatuses: SUPERVISORY_VISIT_OPEN_STATUS_VALUES,
      data,
      tx,
    });
  }

  // Nested write, so the junction rows swap inside the caller's transaction.
  static async replaceCaregivers({visitId, caregiverUserOrganizationIds, tx}) {
    const {success, error} = await PrismaFactory.findOneAndUpdate({
      model: MODELS.SUPERVISORY_VISIT,
      query: {id: visitId},
      data: {
        caregivers: {
          deleteMany: {},
          create: toCaregiverRows({caregiverUserOrganizationIds}),
        },
      },
      options: {bypassExtraQueries: true},
      tx,
    });

    if (!success) {
      throw error instanceof Error
        ? error
        : new Error(error?.message || 'Failed to update visit caregivers');
    }
  }

  static cancelVisit({id, cancelReason, cancelledBy, tx}) {
    return this.transitionVisit({
      id,
      fromStatuses: SUPERVISORY_VISIT_CANCELLABLE_STATUS_VALUES,
      data: {
        status: SUPERVISORY_VISIT_STATUSES.cancelled.value,
        cancelReason,
        cancelledAt: getCurrentTime(),
        cancelledBy,
      },
      tx,
    });
  }

  // Filing = the assignee's completion; the visit then waits for review.
  static fileVisit({
    id,
    answers,
    completionOutcome,
    completionNotes,
    completionFiles,
    completedBy,
    tx,
  }) {
    return this.transitionVisit({
      id,
      fromStatuses: SUPERVISORY_VISIT_OPEN_STATUS_VALUES,
      data: {
        status: SUPERVISORY_VISIT_STATUSES.underReview.value,
        answers,
        completionOutcome,
        completionNotes,
        completionFiles: completionFiles || [],
        completionSource:
          SUPERVISORY_VISIT_COMPLETION_SOURCES.answerSubmitted.value,
        completedAt: getCurrentTime(),
        completedBy: completedBy || null,
      },
      tx,
    });
  }

  static approveVisit({id, reviewedBy, reviewNote, tx}) {
    return this.transitionVisit({
      id,
      fromStatuses: SUPERVISORY_VISIT_REVIEWABLE_STATUS_VALUES,
      data: {
        status: SUPERVISORY_VISIT_STATUSES.approved.value,
        reviewedAt: getCurrentTime(),
        reviewedBy,
        reviewNote: reviewNote || null,
      },
      tx,
    });
  }

  // Answers, findings and evidence stay so the assignee corrects rather than
  // restarts; only the filing marks are cleared.
  static requestCorrection({id, toStatus, tx}) {
    const overdue = toStatus === SUPERVISORY_VISIT_STATUSES.overdue.value;

    return this.transitionVisit({
      id,
      fromStatuses: SUPERVISORY_VISIT_REVIEWABLE_STATUS_VALUES,
      data: {
        status: toStatus,
        overdueAt: overdue ? getCurrentTime() : null,
        completedAt: null,
        completedBy: null,
      },
      tx,
    });
  }

  // PREVENT-772: reopen removed for now; uncomment to restore.
  // // Evidence files stay attached; the REOPENED event keeps the old outcome.
  // static reopenVisit({id, fromStatuses, toStatus, tx}) {
  //   const overdue = toStatus === SUPERVISORY_VISIT_STATUSES.overdue.value;
  //
  //   return this.transitionVisit({
  //     id,
  //     fromStatuses,
  //     data: {
  //       status: toStatus,
  //       overdueAt: overdue ? getCurrentTime() : null,
  //       completionOutcome: null,
  //       completionNotes: null,
  //       completionSource: null,
  //       completedAt: null,
  //       completedBy: null,
  //       reviewedAt: null,
  //       reviewedBy: null,
  //       reviewNote: null,
  //       cancelReason: null,
  //       cancelledAt: null,
  //       cancelledBy: null,
  //     },
  //     tx,
  //   });
  // }

  static markOverdue({id, assigneeUserOrganizationId, now, tx}) {
    return this.transitionVisit({
      id,
      fromStatuses: SUPERVISORY_VISIT_SWEEPABLE_STATUS_VALUES,
      data: {
        status: SUPERVISORY_VISIT_STATUSES.overdue.value,
        overdueAt: now,
        assigneeUserOrganizationId,
      },
      tx,
    });
  }

  // Claims one reminder offset; the NOT-has predicate makes a rerun a no-op.
  static async markReminderSent({id, offsetMinutes, tx}) {
    const {success, error, areDocumentsUpdated} =
      await PrismaFactory.updateMany({
        model: MODELS.SUPERVISORY_VISIT,
        query: {
          id,
          status: {in: SUPERVISORY_VISIT_OPEN_STATUS_VALUES},
          NOT: {sentReminderOffsets: {has: offsetMinutes}},
        },
        data: {sentReminderOffsets: {push: offsetMinutes}},
        options: {bypassExtraQueries: true},
        tx,
      });

    if (!success) {
      throw error instanceof Error
        ? error
        : new Error(error?.message || 'Failed to mark reminder as sent');
    }

    return {updated: Boolean(areDocumentsUpdated)};
  }

  // Open visits assigned to a member, starting within the zone's calendar day.
  static async listDueTodayForAssignee({userOrgId, organizationId, zone}) {
    try {
      const {start, end} = getDayRangeInZone({zone});

      const query = {
        organizationId,
        assigneeUserOrganizationId: userOrgId,
        status: {in: SUPERVISORY_VISIT_OPEN_STATUS_VALUES},
        scheduledStartAt: {gte: start, lte: end},
      };

      const [listResult, countResult] = await Promise.all([
        PrismaFactory.find({
          model: MODELS.SUPERVISORY_VISIT,
          query,
          options: {
            bypassExtraQueries: true,
            sort: SUPERVISORY_VISIT_SCHEDULE_SORT,
          },
          fieldsInclusion: {exclude: LIST_EXCLUDE},
        }),
        PrismaFactory.countDocuments({
          model: MODELS.SUPERVISORY_VISIT,
          query,
          options: {bypassExtraQueries: true},
        }),
      ]);

      if (!listResult.success || !countResult.success) {
        return {
          success: false,
          docs: [],
          count: 0,
          error: listResult.error || countResult.error,
        };
      }

      return {success: true, docs: listResult.docs, count: countResult.count};
    } catch (error) {
      return {success: false, docs: [], count: 0, error};
    }
  }

  // Sweep inputs. No request context: org scoping is explicit downstream and
  // the factory still applies the soft-delete filter. Caregivers ride along
  // because the sweeps notify them.
  static findOverdueCandidates({now}) {
    return PrismaFactory.find({
      model: MODELS.SUPERVISORY_VISIT,
      query: {
        status: {in: SUPERVISORY_VISIT_SWEEPABLE_STATUS_VALUES},
        scheduledEndAt: {lt: now},
      },
      options: {
        bypassExtraQueries: true,
        sort: SUPERVISORY_VISIT_SCHEDULE_SORT,
      },
      fieldsInclusion: {exclude: LIST_EXCLUDE, include: CAREGIVERS_INCLUDE},
    });
  }

  static findReminderCandidates({now, offsetMinutes}) {
    return PrismaFactory.find({
      model: MODELS.SUPERVISORY_VISIT,
      query: {
        status: {in: SUPERVISORY_VISIT_OPEN_STATUS_VALUES},
        NOT: {sentReminderOffsets: {has: offsetMinutes}},
        scheduledStartAt: {
          gt: now,
          lte: addMinutes({date: now, minutes: offsetMinutes}),
        },
      },
      options: {
        bypassExtraQueries: true,
        sort: SUPERVISORY_VISIT_SCHEDULE_SORT,
      },
      fieldsInclusion: {exclude: LIST_EXCLUDE, include: CAREGIVERS_INCLUDE},
    });
  }
};
