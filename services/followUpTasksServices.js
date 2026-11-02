const {modelConstants} = require('../constants');

const {
  FOLLOW_UP_TASK_STATUSES,
  FOLLOW_UP_TASK_OPEN_STATUS_VALUES,
  FOLLOW_UP_TASK_SWEEPABLE_STATUS_VALUES,
  FOLLOW_UP_TASK_COMPLETION_SOURCES,
  FOLLOW_UP_TASK_COMPLETION_OUTCOMES,
  FOLLOW_UP_TASK_SOURCES,
  FOLLOW_UP_TASK_EVENT_TYPES,
  FOLLOW_UP_TASK_DEFAULT_PRIORITY,
  FOLLOW_UP_TASK_DEFAULT_SORT,
  FOLLOW_UP_TASK_DUE_FIRST_SORT,
  FOLLOW_UP_TASK_EVENTS_LIMIT,
} = require('../constants/followUpTasksConstants');

const {PrismaFactory} = require('../factories');

const {
  addMinutes,
  getCurrentTime,
  getDayRangeInZone,
} = require('../utils/dateUtils');

const {recordTaskEvent} = require('../utils/followUpTaskEventUtils');

const {resolveTaskSourceType} = require('../utils/followUpTaskSourceUtils');

const {
  buildNameSearchClause,
  parseNumericFilter,
  safeMerge,
} = require('../utils/general');

const {wrapWithPrismaTransaction} = require('../utils/prismaTransactionUtils');

const {MODELS} = modelConstants;

const PERSON_SELECT = {id: true, firstName: true, lastName: true, email: true};
const USER_ORG_SELECT = {id: true, role: true, user: {select: PERSON_SELECT}};

const FLAG_SELECT = {
  id: true,
  flag: true,
  category: true,
  reason: true,
  description: true,
  status: true,
  createdAt: true,
};

const SUPERVISORY_VISIT_SELECT = {
  id: true,
  visitType: true,
  visitTypeOther: true,
  status: true,
  scheduledStartAt: true,
  scheduledEndAt: true,
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

const DETAILS_INCLUDE = {
  checklistTemplate: {
    include: {
      sections: {
        orderBy: {sortOrder: 'asc'},
        include: {questions: {orderBy: {sortOrder: 'asc'}}},
      },
    },
  },
  submissionFlag: {select: FLAG_SELECT},
  supervisoryVisit: {select: SUPERVISORY_VISIT_SELECT},
  createdByUser: {select: PERSON_SELECT},
  completedByUser: {select: PERSON_SELECT},
  cancelledByUser: {select: PERSON_SELECT},
  events: {
    orderBy: {createdAt: 'desc'},
    take: FOLLOW_UP_TASK_EVENTS_LIMIT,
    select: EVENT_SELECT,
  },
};

// Fields the list never needs (large JSON) -- details fetch them.
const LIST_EXCLUDE = ['answers'];

const SEARCH_FIELDS = [
  'title',
  'patient.firstName',
  'patient.lastName',
  'assignee.user.firstName',
  'assignee.user.lastName',
];

const toStatusList = ({status}) =>
  (Array.isArray(status) ? status : String(status).split(','))
    .map((value) => value.trim())
    .filter(Boolean);

module.exports = class FollowUpTasksServices {
  /**
   * Create a task and its CREATED event atomically. Uses the caller's `tx`
   * when given (escalation resolve) or opens one.
   */
  static async createTask({
    organizationId,
    patientId,
    assigneeUserOrganizationId,
    title,
    description,
    priority,
    dueAt,
    checklistTemplateId,
    submissionFlagId,
    supervisoryVisitId,
    visitInstructions,
    flagType,
    createdBy,
    tx,
  }) {
    const persist = async ({tx: txClient}) => {
      const {success, doc, error} = await PrismaFactory.create({
        model: MODELS.FOLLOW_UP_TASK,
        data: {
          organizationId,
          patientId,
          assigneeUserOrganizationId,
          title,
          description: description || null,
          priority: priority || FOLLOW_UP_TASK_DEFAULT_PRIORITY,
          dueAt,
          checklistTemplateId: checklistTemplateId || null,
          submissionFlagId: submissionFlagId || null,
          supervisoryVisitId: supervisoryVisitId || null,
          visitInstructions: visitInstructions || null,
          flagType: flagType !== undefined ? flagType : null,
          createdBy,
        },
        options: {bypassExtraQueries: true},
        tx: txClient,
      });

      if (!success) {
        throw error instanceof Error
          ? error
          : new Error(error?.message || 'Failed to create follow-up task');
      }

      await recordTaskEvent({
        tx: txClient,
        task: doc,
        type: FOLLOW_UP_TASK_EVENT_TYPES.created.value,
        actorUserId: createdBy,
        toStatus: doc.status,
        toAssigneeUserOrganizationId: assigneeUserOrganizationId,
        payload: {
          source: resolveTaskSourceType({supervisoryVisitId, submissionFlagId}),
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

  static async getTaskById({id, scopeClause = {}, include = {}, tx}) {
    try {
      return await PrismaFactory.findOne({
        model: MODELS.FOLLOW_UP_TASK,
        query: Object.assign({id}, scopeClause),
        fieldsInclusion: {include},
        tx,
      });
    } catch (error) {
      return {success: false, doc: null, error};
    }
  }

  static async getTaskDetails({id, scopeClause = {}}) {
    try {
      return await PrismaFactory.findOne({
        model: MODELS.FOLLOW_UP_TASK,
        query: Object.assign({id}, scopeClause),
        fieldsInclusion: {include: DETAILS_INCLUDE},
      });
    } catch (error) {
      return {success: false, doc: null, error};
    }
  }

  static async listTasks({
    scopeClause = {},
    patientId,
    assigneeUserOrganizationId,
    status,
    priority,
    source,
    flagType,
    search,
    dueFrom,
    dueTo,
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
      if (priority) query.priority = priority;

      if (status) {
        const statuses = toStatusList({status});
        if (statuses.length) query.status = {in: statuses};
      }

      // Matches resolveTaskSourceType, so a filter returns what its column shows.
      if (source === FOLLOW_UP_TASK_SOURCES.supervisoryVisit.value)
        query.supervisoryVisitId = {not: null};
      else if (source === FOLLOW_UP_TASK_SOURCES.alert.value)
        Object.assign(query, {
          submissionFlagId: {not: null},
          supervisoryVisitId: null,
        });
      else if (source === FOLLOW_UP_TASK_SOURCES.standalone.value)
        Object.assign(query, {
          submissionFlagId: null,
          supervisoryVisitId: null,
        });

      // flagType arrives as a query string; 0 = Red Flag is a valid value.
      const parsedFlagType = parseNumericFilter({val: flagType});
      if (parsedFlagType !== null) query.flagType = parsedFlagType;

      if (dueFrom || dueTo) {
        query.dueAt = Object.assign(
          {},
          dueFrom ? {gte: dueFrom} : {},
          dueTo ? {lte: dueTo} : {}
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
        newObj: {sort: sort ?? FOLLOW_UP_TASK_DEFAULT_SORT},
      });

      const result = await PrismaFactory.find({
        model: MODELS.FOLLOW_UP_TASK,
        query,
        options: safeMerge({originalObj: options, newObj: queryOptions}),
        fieldsInclusion: safeMerge({
          originalObj: options.fieldsInclusion || {},
          newObj: {
            exclude: LIST_EXCLUDE,
            include: {
              submissionFlag: {select: FLAG_SELECT},
              supervisoryVisit: {select: SUPERVISORY_VISIT_SELECT},
            },
          },
        }),
      });

      const countResult = await PrismaFactory.countDocuments({
        model: MODELS.FOLLOW_UP_TASK,
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

  // Soft duplicate guard: same patient, assignee, instant and template while open.
  static async getTaskByUniqueKey({
    patientId,
    assigneeUserOrganizationId,
    dueAt,
    checklistTemplateId,
  }) {
    try {
      return await PrismaFactory.findOne({
        model: MODELS.FOLLOW_UP_TASK,
        query: {
          patientId,
          assigneeUserOrganizationId,
          dueAt,
          checklistTemplateId: checklistTemplateId ?? null,
          status: {in: FOLLOW_UP_TASK_OPEN_STATUS_VALUES},
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
  static async transitionTask({id, fromStatuses, data, tx}) {
    const {success, error, areDocumentsUpdated} =
      await PrismaFactory.updateMany({
        model: MODELS.FOLLOW_UP_TASK,
        query: {id, status: {in: fromStatuses}},
        data,
        options: {bypassExtraQueries: true},
        tx,
      });

    if (!success) {
      throw error instanceof Error
        ? error
        : new Error(error?.message || 'Failed to update follow-up task');
    }

    return {updated: Boolean(areDocumentsUpdated)};
  }

  static updateTask({id, data, tx}) {
    return this.transitionTask({
      id,
      fromStatuses: FOLLOW_UP_TASK_OPEN_STATUS_VALUES,
      data,
      tx,
    });
  }

  static cancelTask({id, cancelReason, cancelledBy, tx}) {
    return this.transitionTask({
      id,
      fromStatuses: FOLLOW_UP_TASK_OPEN_STATUS_VALUES,
      data: {
        status: FOLLOW_UP_TASK_STATUSES.cancelled.value,
        cancelReason,
        cancelledAt: getCurrentTime(),
        cancelledBy,
      },
      tx,
    });
  }

  // PREVENT-772: reopen removed for now; uncomment to restore.
  // // Evidence files stay attached; the REOPENED event keeps the old outcome.
  // static reopenTask({id, fromStatuses, toStatus, tx}) {
  //   const overdue = toStatus === FOLLOW_UP_TASK_STATUSES.overdue.value;
  //
  //   return this.transitionTask({
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
  //       cancelReason: null,
  //       cancelledAt: null,
  //       cancelledBy: null,
  //     },
  //     tx,
  //   });
  // }

  static completeTask({
    id,
    completionOutcome,
    completionNotes,
    completionFiles,
    answers,
    completedBy,
    tx,
  }) {
    return this.transitionTask({
      id,
      fromStatuses: FOLLOW_UP_TASK_OPEN_STATUS_VALUES,
      data: Object.assign(
        {
          status: FOLLOW_UP_TASK_STATUSES.completed.value,
          completionOutcome,
          completionNotes,
          completionFiles: completionFiles || [],
          completionSource: answers
            ? FOLLOW_UP_TASK_COMPLETION_SOURCES.answerSubmitted.value
            : FOLLOW_UP_TASK_COMPLETION_SOURCES.outcomeSubmitted.value,
          completedAt: getCurrentTime(),
          completedBy: completedBy || null,
        },
        answers ? {answers} : {}
      ),
      tx,
    });
  }

  // Legacy one-shot checklist submission.
  static submitTaskAnswers({id, answers, completedBy, tx}) {
    return this.transitionTask({
      id,
      fromStatuses: FOLLOW_UP_TASK_OPEN_STATUS_VALUES,
      data: {
        answers,
        status: FOLLOW_UP_TASK_STATUSES.completed.value,
        completionOutcome: FOLLOW_UP_TASK_COMPLETION_OUTCOMES.done.value,
        completionSource:
          FOLLOW_UP_TASK_COMPLETION_SOURCES.answerSubmitted.value,
        completedAt: getCurrentTime(),
        completedBy: completedBy || null,
      },
      tx,
    });
  }

  // Legacy reply submission.
  static submitTaskReply({
    id,
    caseManagerReply,
    caseManagerReplyFiles,
    completedBy,
    tx,
  }) {
    return this.transitionTask({
      id,
      fromStatuses: FOLLOW_UP_TASK_OPEN_STATUS_VALUES,
      data: {
        caseManagerReply,
        caseManagerReplyFiles: caseManagerReplyFiles || [],
        status: FOLLOW_UP_TASK_STATUSES.completed.value,
        completionOutcome: FOLLOW_UP_TASK_COMPLETION_OUTCOMES.done.value,
        completionSource:
          FOLLOW_UP_TASK_COMPLETION_SOURCES.replySubmitted.value,
        completedAt: getCurrentTime(),
        completedBy: completedBy || null,
      },
      tx,
    });
  }

  static markOverdue({id, assigneeUserOrganizationId, now, tx}) {
    return this.transitionTask({
      id,
      fromStatuses: FOLLOW_UP_TASK_SWEEPABLE_STATUS_VALUES,
      data: {
        status: FOLLOW_UP_TASK_STATUSES.overdue.value,
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
        model: MODELS.FOLLOW_UP_TASK,
        query: {
          id,
          status: {in: FOLLOW_UP_TASK_OPEN_STATUS_VALUES},
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

  // Open tasks assigned to a member, due within the zone's calendar day.
  static async listDueTodayForAssignee({userOrgId, organizationId, zone}) {
    try {
      const {start, end} = getDayRangeInZone({zone});

      const query = {
        organizationId,
        assigneeUserOrganizationId: userOrgId,
        status: {in: FOLLOW_UP_TASK_OPEN_STATUS_VALUES},
        dueAt: {gte: start, lte: end},
      };

      const [listResult, countResult] = await Promise.all([
        PrismaFactory.find({
          model: MODELS.FOLLOW_UP_TASK,
          query,
          options: {
            bypassExtraQueries: true,
            sort: FOLLOW_UP_TASK_DUE_FIRST_SORT,
          },
          fieldsInclusion: {exclude: LIST_EXCLUDE},
        }),
        PrismaFactory.countDocuments({
          model: MODELS.FOLLOW_UP_TASK,
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
  // the factory still applies the soft-delete filter.
  static findOverdueCandidates({now}) {
    return PrismaFactory.find({
      model: MODELS.FOLLOW_UP_TASK,
      query: {
        status: {in: FOLLOW_UP_TASK_SWEEPABLE_STATUS_VALUES},
        dueAt: {lt: now},
      },
      options: {bypassExtraQueries: true, sort: FOLLOW_UP_TASK_DUE_FIRST_SORT},
      fieldsInclusion: {exclude: LIST_EXCLUDE},
    });
  }

  static findReminderCandidates({now, offsetMinutes}) {
    return PrismaFactory.find({
      model: MODELS.FOLLOW_UP_TASK,
      query: {
        status: {in: FOLLOW_UP_TASK_OPEN_STATUS_VALUES},
        NOT: {sentReminderOffsets: {has: offsetMinutes}},
        dueAt: {gt: now, lte: addMinutes({date: now, minutes: offsetMinutes})},
      },
      options: {bypassExtraQueries: true, sort: FOLLOW_UP_TASK_DUE_FIRST_SORT},
      fieldsInclusion: {exclude: LIST_EXCLUDE},
    });
  }
};
