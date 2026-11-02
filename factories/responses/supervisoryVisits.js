const AppResponse = require('./app');
const AssessmentsResponsesFactories = require('./assessments');

const {
  findMeta,
  formatPerson,
  formatAssignee,
  formatWorkItemEvent,
  formatFlagSource,
  buildTemplateQuestionMap,
  formatChecklistAnswer,
} = require('./workItems');

const {
  FOLLOW_UP_TASK_STATUSES,
  FOLLOW_UP_TASK_PRIORITIES,
} = require('../../constants/followUpTasksConstants');

const {
  SUPERVISORY_VISIT_SUCCESS_TYPES,
} = require('../../constants/responses/success/supervisoryVisits');

const {
  SUPERVISORY_VISIT_STATUSES,
  SUPERVISORY_VISIT_OPEN_STATUS_VALUES,
  SUPERVISORY_VISIT_TYPES,
  SUPERVISORY_VISIT_COMPLETION_OUTCOMES,
  SUPERVISORY_VISIT_COMPLETION_SOURCES,
  SUPERVISORY_VISIT_SOURCES,
  SUPERVISORY_VISIT_EVENT_TYPES,
} = require('../../constants/supervisoryVisitsConstants');

const {getCurrentTime, getMinutesBetween} = require('../../utils/dateUtils');

const {
  findEscalationEvent,
} = require('../../utils/supervisoryVisitHistoryUtils');

const formatCaregiver = ({entry}) => formatAssignee({userOrg: entry.userOrg});

const formatLinkedTask = ({task}) => ({
  id: task.id,
  title: task.title,
  status: task.status,
  statusMeta: findMeta({catalog: FOLLOW_UP_TASK_STATUSES, value: task.status}),
  priority: task.priority,
  priorityMeta: findMeta({
    catalog: FOLLOW_UP_TASK_PRIORITIES,
    value: task.priority,
  }),
  dueAt: task.dueAt,
  assignee: formatAssignee({userOrg: task.assignee}),
});

module.exports = class SupervisoryVisitsResponsesFactories {
  static formatEvent({event}) {
    return formatWorkItemEvent({
      event,
      eventTypes: SUPERVISORY_VISIT_EVENT_TYPES,
    });
  }

  // A visit created by a flag-resolution is ALERT-sourced even when the flag
  // relation is not loaded (list rows only carry the id).
  static formatSource({visit}) {
    const source = formatFlagSource({
      flag: visit.submissionFlag || null,
      sources: SUPERVISORY_VISIT_SOURCES,
    });

    if (visit.submissionFlagId)
      source.type = SUPERVISORY_VISIT_SOURCES.alert.value;

    return source;
  }

  static formatVisit({visit}) {
    const now = getCurrentTime();
    const isOpen = SUPERVISORY_VISIT_OPEN_STATUS_VALUES.includes(visit.status);

    const questionMap = visit.checklistTemplate
      ? buildTemplateQuestionMap({template: visit.checklistTemplate})
      : {};

    const formattedAnswers = Array.isArray(visit.answers)
      ? visit.answers.map((answer) =>
          formatChecklistAnswer({answer, questionMap})
        )
      : undefined;

    // Details carry the history; the sweep's hand-off event names the
    // original assignee.
    const escalationEvent = findEscalationEvent({visit});

    // Positive = past the window (open) or filed late; negative = time left.
    const scheduleDeltaMinutes =
      visit.scheduledEndAt && (isOpen || visit.completedAt)
        ? getMinutesBetween({
            from: visit.scheduledEndAt,
            to: visit.completedAt || now,
          })
        : null;

    return {
      id: visit.id,
      organizationId: visit.organizationId,
      patientId: visit.patientId,
      patient: visit.patient || undefined,
      visitType: visit.visitType,
      visitTypeMeta: findMeta({
        catalog: SUPERVISORY_VISIT_TYPES,
        value: visit.visitType,
      }),
      visitTypeOther: visit.visitTypeOther || null,
      description: visit.description || null,
      status: visit.status,
      statusMeta: findMeta({
        catalog: SUPERVISORY_VISIT_STATUSES,
        value: visit.status,
      }),
      isOverdue:
        visit.status === SUPERVISORY_VISIT_STATUSES.overdue.value ||
        (isOpen && scheduleDeltaMinutes > 0),
      scheduledStartAt: visit.scheduledStartAt,
      scheduledEndAt: visit.scheduledEndAt,
      scheduleDeltaMinutes,
      sentReminderOffsets: visit.sentReminderOffsets || [],
      assigneeUserOrganizationId: visit.assigneeUserOrganizationId,
      assignee: formatAssignee({userOrg: visit.assignee}),
      originalAssignee: formatAssignee({
        userOrg: escalationEvent?.fromAssignee || null,
      }),
      caregivers: Array.isArray(visit.caregivers)
        ? visit.caregivers.map((entry) => formatCaregiver({entry}))
        : undefined,
      caregiversCount: Array.isArray(visit.caregivers)
        ? visit.caregivers.length
        : (visit._count?.caregivers ?? undefined),
      source: SupervisoryVisitsResponsesFactories.formatSource({visit}),
      checklistTemplateId: visit.checklistTemplateId,
      checklistTemplate: visit.checklistTemplate
        ? AssessmentsResponsesFactories.formatTemplate({
            template: visit.checklistTemplate,
          })
        : undefined,
      answers: formattedAnswers,
      completionOutcome: visit.completionOutcome || null,
      completionOutcomeMeta: findMeta({
        catalog: SUPERVISORY_VISIT_COMPLETION_OUTCOMES,
        value: visit.completionOutcome,
      }),
      completionNotes: visit.completionNotes || null,
      completionFiles: Array.isArray(visit.completionFiles)
        ? visit.completionFiles
        : [],
      completionSource: visit.completionSource || null,
      completionSourceMeta: findMeta({
        catalog: SUPERVISORY_VISIT_COMPLETION_SOURCES,
        value: visit.completionSource,
      }),
      overdueAt: visit.overdueAt || null,
      completedAt: visit.completedAt || null,
      completedBy: visit.completedBy || null,
      completedByUser: formatPerson({user: visit.completedByUser}) || undefined,
      reviewedAt: visit.reviewedAt || null,
      reviewedBy: visit.reviewedBy || null,
      reviewedByUser: formatPerson({user: visit.reviewedByUser}) || undefined,
      reviewNote: visit.reviewNote || null,
      cancelReason: visit.cancelReason || null,
      cancelledAt: visit.cancelledAt || null,
      cancelledBy: visit.cancelledBy || null,
      cancelledByUser: formatPerson({user: visit.cancelledByUser}) || undefined,
      followUpTasks: Array.isArray(visit.followUpTasks)
        ? visit.followUpTasks.map((task) => formatLinkedTask({task}))
        : undefined,
      createdBy: visit.createdBy,
      createdByUser: formatPerson({user: visit.createdByUser}) || undefined,
      events: Array.isArray(visit.events)
        ? visit.events.map((event) =>
            SupervisoryVisitsResponsesFactories.formatEvent({event})
          )
        : undefined,
      createdAt: visit.createdAt,
      updatedAt: visit.updatedAt,
    };
  }

  static visitResponse({visit, message, type, statusCode = 200}) {
    return new AppResponse({
      message,
      statusCode,
      body: {
        visit: SupervisoryVisitsResponsesFactories.formatVisit({visit}),
        type,
      },
    });
  }

  static visitCreated({visit}) {
    return SupervisoryVisitsResponsesFactories.visitResponse({
      visit,
      message: 'Supervisory visit scheduled successfully',
      statusCode: 201,
      type: SUPERVISORY_VISIT_SUCCESS_TYPES.supervisoryVisitCreated.value,
    });
  }

  static visitRetrieved({visit}) {
    return SupervisoryVisitsResponsesFactories.visitResponse({
      visit,
      message: 'Supervisory visit retrieved successfully',
      type: SUPERVISORY_VISIT_SUCCESS_TYPES.supervisoryVisitRetrieved.value,
    });
  }

  static visitUpdated({visit}) {
    return SupervisoryVisitsResponsesFactories.visitResponse({
      visit,
      message: 'Supervisory visit updated successfully',
      type: SUPERVISORY_VISIT_SUCCESS_TYPES.supervisoryVisitUpdated.value,
    });
  }

  static visitCancelled({visit}) {
    return SupervisoryVisitsResponsesFactories.visitResponse({
      visit,
      message: 'Supervisory visit cancelled',
      type: SUPERVISORY_VISIT_SUCCESS_TYPES.supervisoryVisitCancelled.value,
    });
  }

  // PREVENT-772: reopen removed for now; uncomment to restore.
  // static visitReopened({visit}) {
  //   return SupervisoryVisitsResponsesFactories.visitResponse({
  //     visit,
  //     message: 'Supervisory visit reopened',
  //     type: SUPERVISORY_VISIT_SUCCESS_TYPES.supervisoryVisitReopened.value,
  //   });
  // }

  static visitFiled({visit}) {
    return SupervisoryVisitsResponsesFactories.visitResponse({
      visit,
      message: 'Supervisory visit filed for review',
      type: SUPERVISORY_VISIT_SUCCESS_TYPES.supervisoryVisitFiled.value,
    });
  }

  static visitApproved({visit}) {
    return SupervisoryVisitsResponsesFactories.visitResponse({
      visit,
      message: 'Supervisory visit approved',
      type: SUPERVISORY_VISIT_SUCCESS_TYPES.supervisoryVisitApproved.value,
    });
  }

  static visitCorrectionRequested({visit}) {
    return SupervisoryVisitsResponsesFactories.visitResponse({
      visit,
      message: 'Supervisory visit sent back for correction',
      type: SUPERVISORY_VISIT_SUCCESS_TYPES.supervisoryVisitCorrectionRequested
        .value,
    });
  }

  static assigneesListed({assignees}) {
    return new AppResponse({
      message: 'Care team retrieved successfully',
      statusCode: 200,
      body: {
        assignees,
        type: SUPERVISORY_VISIT_SUCCESS_TYPES.supervisoryVisitAssigneesListed
          .value,
      },
    });
  }

  static visitsListed({visits, meta}) {
    return new AppResponse({
      message: 'Supervisory visits retrieved successfully',
      statusCode: 200,
      body: {
        visits: visits.map((v) =>
          SupervisoryVisitsResponsesFactories.formatVisit({visit: v})
        ),
        meta,
        type: SUPERVISORY_VISIT_SUCCESS_TYPES.supervisoryVisitsListed.value,
      },
    });
  }
};
