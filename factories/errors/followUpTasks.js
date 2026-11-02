const AppError = require('./app');

const {
  FOLLOW_UP_TASK_ERRORS_TYPES,
} = require('../../constants/responses/errors/followUpTasks');

module.exports = class FollowUpTasksErrorsFactories {
  static notFoundErr({customMessage} = {}) {
    return new AppError({
      message: customMessage || 'Follow-up task not found',
      statusCode: 404,
      error: {
        type: FOLLOW_UP_TASK_ERRORS_TYPES.followUpTaskNotFound.value,
      },
    });
  }

  static duplicateTaskErr({customMessage} = {}) {
    return new AppError({
      message:
        customMessage ||
        'A follow-up task already exists for this patient, case manager, and scheduled date',
      statusCode: 409,
      error: {
        type: FOLLOW_UP_TASK_ERRORS_TYPES.duplicateFollowUpTask.value,
      },
    });
  }

  static alreadyCompletedErr({customMessage} = {}) {
    return new AppError({
      message: customMessage || 'Follow-up task is already completed',
      statusCode: 409,
      error: {
        type: FOLLOW_UP_TASK_ERRORS_TYPES.followUpTaskAlreadyCompleted.value,
      },
    });
  }

  static templateOrInstructionsRequiredErr({customMessage} = {}) {
    return new AppError({
      message:
        customMessage ||
        'Either checklistTemplateId or visitInstructions is required',
      statusCode: 422,
      error: {
        type: FOLLOW_UP_TASK_ERRORS_TYPES.templateOrInstructionsRequired.value,
      },
    });
  }

  static templateNotFoundErr({customMessage} = {}) {
    return new AppError({
      message:
        customMessage ||
        'Checklist template not found or not available for case managers',
      statusCode: 404,
      error: {
        type: FOLLOW_UP_TASK_ERRORS_TYPES.templateNotFound.value,
      },
    });
  }

  static caseManagerReplyRequiredErr({customMessage} = {}) {
    return new AppError({
      message:
        customMessage ||
        'Case manager reply is required when no checklist template is attached',
      statusCode: 422,
      error: {
        type: FOLLOW_UP_TASK_ERRORS_TYPES.caseManagerReplyRequired.value,
      },
    });
  }

  static assigneeRequiredErr({customMessage} = {}) {
    return new AppError({
      message:
        customMessage ||
        'This patient has no case manager; choose who the follow-up task is assigned to',
      statusCode: 422,
      error: {
        type: FOLLOW_UP_TASK_ERRORS_TYPES.assigneeRequired.value,
      },
    });
  }

  static assigneeNotInCareTeamErr({customMessage} = {}) {
    return new AppError({
      message:
        customMessage ||
        "The assignee must be a member of the patient's care team",
      statusCode: 422,
      error: {
        type: FOLLOW_UP_TASK_ERRORS_TYPES.assigneeNotInCareTeam.value,
      },
    });
  }

  static invalidStatusTransitionErr({customMessage} = {}) {
    return new AppError({
      message:
        customMessage ||
        'This action is not allowed in the task’s current status',
      statusCode: 409,
      error: {
        type: FOLLOW_UP_TASK_ERRORS_TYPES.invalidStatusTransition.value,
      },
    });
  }

  static forbiddenTaskActionErr({customMessage} = {}) {
    return new AppError({
      message:
        customMessage ||
        'You are not allowed to perform this action on this task',
      statusCode: 403,
      error: {
        type: FOLLOW_UP_TASK_ERRORS_TYPES.forbiddenTaskAction.value,
      },
    });
  }

  static tooManyEvidenceFilesErr({maxAllowed, customMessage} = {}) {
    return new AppError({
      message:
        customMessage || `At most ${maxAllowed} evidence files can be attached`,
      statusCode: 422,
      error: {
        type: FOLLOW_UP_TASK_ERRORS_TYPES.tooManyEvidenceFiles.value,
      },
    });
  }

  static unexpectedAnswersWithoutTemplateErr({customMessage} = {}) {
    return new AppError({
      message:
        customMessage ||
        'Answers cannot be submitted for a task without a checklist template',
      statusCode: 422,
      error: {
        type: FOLLOW_UP_TASK_ERRORS_TYPES.unexpectedAnswersWithoutTemplate
          .value,
      },
    });
  }
};
