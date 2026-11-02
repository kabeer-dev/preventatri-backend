const AppError = require('./app');

const {
  CHECKLIST_TEMPLATE_ERRORS_TYPES,
  CHECKLIST_SUBMISSION_ERRORS_TYPES,
} = require('../../constants/responses/errors/assessments');

module.exports = class AssessmentsErrorsFactories {
  static templateNotFoundErr({customMessage} = {}) {
    return new AppError({
      message: customMessage || 'Checklist template not found',
      statusCode: 404,
      error: {type: CHECKLIST_TEMPLATE_ERRORS_TYPES.templateNotFound.value},
    });
  }

  static templateInactiveErr({customMessage} = {}) {
    return new AppError({
      message: customMessage || 'Checklist template is inactive',
      statusCode: 400,
      error: {type: CHECKLIST_TEMPLATE_ERRORS_TYPES.templateInactive.value},
    });
  }

  static invalidFieldsErr({customMessage} = {}) {
    return new AppError({
      message: customMessage || 'Invalid checklist fields',
      statusCode: 400,
      error: {type: CHECKLIST_TEMPLATE_ERRORS_TYPES.invalidFields.value},
    });
  }

  static templateTitleAlreadyExistsErr({title} = {}) {
    return new AppError({
      message: title
        ? `A checklist template with title '${title}' already exists in this organization`
        : 'A checklist template with this title already exists in this organization',
      statusCode: 409,
      error: {
        type: CHECKLIST_TEMPLATE_ERRORS_TYPES.templateTitleAlreadyExists.value,
      },
    });
  }

  static templateStatusTransitionNotAllowedErr({from, to} = {}) {
    return new AppError({
      message:
        from && to
          ? `A ${from} checklist template cannot be moved to ${to}`
          : 'This checklist template status change is not allowed',
      statusCode: 409,
      error: {
        type: CHECKLIST_TEMPLATE_ERRORS_TYPES.templateStatusTransitionNotAllowed
          .value,
      },
    });
  }

  static templateIncompleteErr({customMessage} = {}) {
    return new AppError({
      message:
        customMessage ||
        'This checklist template is not complete enough to publish',
      statusCode: 400,
      error: {type: CHECKLIST_TEMPLATE_ERRORS_TYPES.templateIncomplete.value},
    });
  }

  static templateNotEditableErr({customMessage} = {}) {
    return new AppError({
      message:
        customMessage ||
        'Only draft checklist templates can be edited or deleted',
      statusCode: 409,
      error: {type: CHECKLIST_TEMPLATE_ERRORS_TYPES.templateNotEditable.value},
    });
  }

  // ==========================================
  // CHECKLIST SUBMISSION ERRORS
  // ==========================================

  static submissionNotFoundErr({customMessage} = {}) {
    return new AppError({
      message: customMessage || 'Checklist submission not found',
      statusCode: 404,
      error: {
        type: CHECKLIST_SUBMISSION_ERRORS_TYPES.submissionNotFound.value,
      },
    });
  }

  static patientNotAssignedErr({customMessage} = {}) {
    return new AppError({
      message: customMessage || 'You are not assigned to this patient',
      statusCode: 403,
      error: {
        type: CHECKLIST_SUBMISSION_ERRORS_TYPES.patientNotAssigned.value,
      },
    });
  }

  static caregiverProfileNotFoundErr({customMessage} = {}) {
    return new AppError({
      message: customMessage || 'Caregiver profile not found for this user',
      statusCode: 404,
      error: {
        type: CHECKLIST_SUBMISSION_ERRORS_TYPES.caregiverProfileNotFound.value,
      },
    });
  }

  static requiredQuestionsUnansweredErr({missingQuestions} = {}) {
    return new AppError({
      message: 'Required questions must be answered',
      statusCode: 400,
      error: {
        type: CHECKLIST_SUBMISSION_ERRORS_TYPES.requiredQuestionsUnanswered
          .value,
        missingQuestions,
      },
    });
  }

  static invalidAnswerValuesErr({invalidAnswers} = {}) {
    return new AppError({
      message: 'One or more answers have invalid values',
      statusCode: 400,
      error: {
        type: CHECKLIST_SUBMISSION_ERRORS_TYPES.invalidAnswerValues.value,
        invalidAnswers,
      },
    });
  }

  static answerNotFoundErr({customMessage} = {}) {
    return new AppError({
      message: customMessage || 'Submission answer not found',
      statusCode: 404,
      error: {type: CHECKLIST_SUBMISSION_ERRORS_TYPES.answerNotFound.value},
    });
  }

  static tooManyAttachmentsPerQuestionErr({
    maxAllowed,
    offendingQuestions,
  } = {}) {
    return new AppError({
      message: `A question can have at most ${maxAllowed} attachments`,
      statusCode: 400,
      error: {
        type: CHECKLIST_SUBMISSION_ERRORS_TYPES.tooManyAttachmentsPerQuestion
          .value,
        maxAllowed,
        offendingQuestions,
      },
    });
  }

  static escalationNotFoundErr({customMessage} = {}) {
    return new AppError({
      message:
        customMessage || 'Escalation not found or is not assigned to you',
      statusCode: 404,
      error: {
        type: CHECKLIST_SUBMISSION_ERRORS_TYPES.escalationNotFound.value,
      },
    });
  }

  static escalationAlreadyResolvedErr({customMessage} = {}) {
    return new AppError({
      message: customMessage || 'This escalation has already been resolved',
      statusCode: 409,
      error: {
        type: CHECKLIST_SUBMISSION_ERRORS_TYPES.escalationAlreadyResolved.value,
      },
    });
  }

  static escalationExpiredErr({customMessage} = {}) {
    return new AppError({
      message:
        customMessage ||
        'This escalation has expired and is being reassigned to the next level; it can no longer be resolved by you',
      statusCode: 409,
      error: {
        type: CHECKLIST_SUBMISSION_ERRORS_TYPES.escalationExpired.value,
      },
    });
  }

  // Accept is offered only while the flag is still waiting on its assignee
  // and can still escalate.
  static escalationNotAcceptableErr({customMessage} = {}) {
    return new AppError({
      message: customMessage || 'This escalation can no longer be accepted',
      statusCode: 409,
      error: {
        type: CHECKLIST_SUBMISSION_ERRORS_TYPES.escalationNotAcceptable.value,
      },
    });
  }
};
