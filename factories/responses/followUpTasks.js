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
  FOLLOW_UP_TASK_OPEN_STATUS_VALUES,
  FOLLOW_UP_TASK_FLAG_TYPES,
  FOLLOW_UP_TASK_PRIORITIES,
  FOLLOW_UP_TASK_COMPLETION_OUTCOMES,
  FOLLOW_UP_TASK_COMPLETION_SOURCES,
  FOLLOW_UP_TASK_SOURCES,
  FOLLOW_UP_TASK_EVENT_TYPES,
} = require('../../constants/followUpTasksConstants');

const {
  FOLLOW_UP_TASK_SUCCESS_TYPES,
} = require('../../constants/responses/success/followUpTasks');

const {
  SUPERVISORY_VISIT_STATUSES,
  SUPERVISORY_VISIT_TYPES,
} = require('../../constants/supervisoryVisitsConstants');

const {getCurrentTime, getMinutesBetween} = require('../../utils/dateUtils');

const {findEscalationEvent} = require('../../utils/followUpTaskHistoryUtils');
const {resolveTaskSourceType} = require('../../utils/followUpTaskSourceUtils');

module.exports = class FollowUpTasksResponsesFactories {
  static formatTaskAnswer({answer, questionMap}) {
    return formatChecklistAnswer({answer, questionMap});
  }

  static formatEvent({event}) {
    return formatWorkItemEvent({event, eventTypes: FOLLOW_UP_TASK_EVENT_TYPES});
  }

  // A task created by a flag-resolution is ALERT-sourced even when the flag
  // relation is not loaded (list rows only carry the id).
  static formatSource({task}) {
    const source = formatFlagSource({
      flag: task.submissionFlag || null,
      sources: FOLLOW_UP_TASK_SOURCES,
    });

    source.type = resolveTaskSourceType({
      supervisoryVisitId: task.supervisoryVisitId,
      submissionFlagId: task.submissionFlagId,
    });

    return source;
  }

  // canOpen is set by the controller from the caller's visit scope.
  static formatSupervisoryVisit({visit}) {
    if (!visit) return null;

    return {
      id: visit.id,
      visitType: visit.visitType,
      visitTypeMeta: findMeta({
        catalog: SUPERVISORY_VISIT_TYPES,
        value: visit.visitType,
      }),
      visitTypeOther: visit.visitTypeOther || null,
      status: visit.status,
      statusMeta: findMeta({
        catalog: SUPERVISORY_VISIT_STATUSES,
        value: visit.status,
      }),
      scheduledStartAt: visit.scheduledStartAt,
      scheduledEndAt: visit.scheduledEndAt,
      canOpen: visit.canOpen === true,
    };
  }

  static formatTask({task}) {
    const now = getCurrentTime();
    const isOpen = FOLLOW_UP_TASK_OPEN_STATUS_VALUES.includes(task.status);

    const isCompleted = task.status === FOLLOW_UP_TASK_STATUSES.completed.value;

    const questionMap = task.checklistTemplate
      ? buildTemplateQuestionMap({template: task.checklistTemplate})
      : {};

    const formattedAnswers = Array.isArray(task.answers)
      ? task.answers.map((answer) =>
          FollowUpTasksResponsesFactories.formatTaskAnswer({
            answer,
            questionMap,
          })
        )
      : [];

    // Details carry the history; the sweep's hand-off event names the
    // original assignee.
    const escalationEvent = findEscalationEvent({task});

    // Positive = past due (open) or completed late; negative = completed early.
    const dueDeltaMinutes =
      task.dueAt && (isOpen || isCompleted)
        ? getMinutesBetween({
            from: task.dueAt,
            to: isCompleted ? task.completedAt || now : now,
          })
        : null;

    return {
      id: task.id,
      organizationId: task.organizationId,
      patientId: task.patientId,
      patient: task.patient || undefined,
      title: task.title,
      description: task.description || null,
      priority: task.priority,
      priorityMeta: findMeta({
        catalog: FOLLOW_UP_TASK_PRIORITIES,
        value: task.priority,
      }),
      status: task.status,
      statusMeta: findMeta({
        catalog: FOLLOW_UP_TASK_STATUSES,
        value: task.status,
      }),
      isOverdue:
        task.status === FOLLOW_UP_TASK_STATUSES.overdue.value ||
        (isOpen && dueDeltaMinutes > 0),
      dueAt: task.dueAt,
      dueDeltaMinutes,
      sentReminderOffsets: task.sentReminderOffsets || [],
      assigneeUserOrganizationId: task.assigneeUserOrganizationId,
      assignee: formatAssignee({userOrg: task.assignee}),
      originalAssignee: formatAssignee({
        userOrg: escalationEvent?.fromAssignee || null,
      }),
      source: FollowUpTasksResponsesFactories.formatSource({task}),
      checklistTemplateId: task.checklistTemplateId,
      supervisoryVisitId: task.supervisoryVisitId || null,
      supervisoryVisit: FollowUpTasksResponsesFactories.formatSupervisoryVisit({
        visit: task.supervisoryVisit,
      }),
      checklistTemplate: task.checklistTemplate
        ? AssessmentsResponsesFactories.formatTemplate({
            template: task.checklistTemplate,
          })
        : undefined,
      visitInstructions: task.visitInstructions,
      flagType: task.flagType,
      flagMeta:
        task.flagType !== null && task.flagType !== undefined
          ? FOLLOW_UP_TASK_FLAG_TYPES[task.flagType] || null
          : null,
      answers: task.answers === undefined ? undefined : formattedAnswers,
      caseManagerReply: task.caseManagerReply || null,
      caseManagerReplyFiles: Array.isArray(task.caseManagerReplyFiles)
        ? task.caseManagerReplyFiles
        : [],
      completionOutcome: task.completionOutcome || null,
      completionOutcomeMeta: findMeta({
        catalog: FOLLOW_UP_TASK_COMPLETION_OUTCOMES,
        value: task.completionOutcome,
      }),
      completionNotes: task.completionNotes,
      completionFiles: Array.isArray(task.completionFiles)
        ? task.completionFiles
        : [],
      completionSource: task.completionSource,
      completionSourceMeta: findMeta({
        catalog: FOLLOW_UP_TASK_COMPLETION_SOURCES,
        value: task.completionSource,
      }),
      overdueAt: task.overdueAt || null,
      completedAt: task.completedAt,
      completedBy: task.completedBy || null,
      completedByUser: formatPerson({user: task.completedByUser}) || undefined,
      cancelReason: task.cancelReason || null,
      cancelledAt: task.cancelledAt || null,
      cancelledBy: task.cancelledBy || null,
      cancelledByUser: formatPerson({user: task.cancelledByUser}) || undefined,
      createdBy: task.createdBy,
      createdByUser: formatPerson({user: task.createdByUser}) || undefined,
      events: Array.isArray(task.events)
        ? task.events.map((event) =>
            FollowUpTasksResponsesFactories.formatEvent({event})
          )
        : undefined,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
    };
  }

  static taskResponse({task, message, type, statusCode = 200}) {
    return new AppResponse({
      message,
      statusCode,
      body: {task: FollowUpTasksResponsesFactories.formatTask({task}), type},
    });
  }

  static taskCreated({task}) {
    return FollowUpTasksResponsesFactories.taskResponse({
      task,
      message: 'Follow-up task created successfully',
      statusCode: 201,
      type: FOLLOW_UP_TASK_SUCCESS_TYPES.followUpTaskCreated.value,
    });
  }

  static taskCompleted({task}) {
    return FollowUpTasksResponsesFactories.taskResponse({
      task,
      message: 'Follow-up task marked as completed',
      type: FOLLOW_UP_TASK_SUCCESS_TYPES.followUpTaskCompleted.value,
    });
  }

  static taskSubmitted({task}) {
    return FollowUpTasksResponsesFactories.taskResponse({
      task,
      message: 'Follow-up task submitted successfully',
      type: FOLLOW_UP_TASK_SUCCESS_TYPES.followUpTaskSubmitted.value,
    });
  }

  static taskRetrieved({task}) {
    return FollowUpTasksResponsesFactories.taskResponse({
      task,
      message: 'Follow-up task retrieved successfully',
      type: FOLLOW_UP_TASK_SUCCESS_TYPES.followUpTaskRetrieved.value,
    });
  }

  static taskUpdated({task}) {
    return FollowUpTasksResponsesFactories.taskResponse({
      task,
      message: 'Follow-up task updated successfully',
      type: FOLLOW_UP_TASK_SUCCESS_TYPES.followUpTaskUpdated.value,
    });
  }

  static taskCancelled({task}) {
    return FollowUpTasksResponsesFactories.taskResponse({
      task,
      message: 'Follow-up task cancelled',
      type: FOLLOW_UP_TASK_SUCCESS_TYPES.followUpTaskCancelled.value,
    });
  }

  // PREVENT-772: reopen removed for now; uncomment to restore.
  // static taskReopened({task}) {
  //   return FollowUpTasksResponsesFactories.taskResponse({
  //     task,
  //     message: 'Follow-up task reopened',
  //     type: FOLLOW_UP_TASK_SUCCESS_TYPES.followUpTaskReopened.value,
  //   });
  // }

  static assigneesListed({assignees}) {
    return new AppResponse({
      message: 'Care team retrieved successfully',
      statusCode: 200,
      body: {
        assignees,
        type: FOLLOW_UP_TASK_SUCCESS_TYPES.followUpTaskAssigneesListed.value,
      },
    });
  }

  static tasksListed({tasks, meta}) {
    return new AppResponse({
      message: 'Follow-up tasks retrieved successfully',
      statusCode: 200,
      body: {
        tasks: tasks.map((t) =>
          FollowUpTasksResponsesFactories.formatTask({task: t})
        ),
        meta,
        type: FOLLOW_UP_TASK_SUCCESS_TYPES.followUpTasksListed.value,
      },
    });
  }
};
