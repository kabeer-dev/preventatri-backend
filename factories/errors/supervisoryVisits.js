const AppError = require('./app');

const {
  SUPERVISORY_VISIT_ERRORS_TYPES,
} = require('../../constants/responses/errors/supervisoryVisits');

module.exports = class SupervisoryVisitsErrorsFactories {
  static notFoundErr({customMessage} = {}) {
    return new AppError({
      message: customMessage || 'Supervisory visit not found',
      statusCode: 404,
      error: {
        type: SUPERVISORY_VISIT_ERRORS_TYPES.supervisoryVisitNotFound.value,
      },
    });
  }

  static duplicateVisitErr({customMessage} = {}) {
    return new AppError({
      message:
        customMessage ||
        'An open supervisory visit already exists for this patient, assignee and start time',
      statusCode: 409,
      error: {
        type: SUPERVISORY_VISIT_ERRORS_TYPES.duplicateVisit.value,
      },
    });
  }

  static patientNotAssignedErr({customMessage} = {}) {
    return new AppError({
      message:
        customMessage || 'The patient is not assigned to this case manager',
      statusCode: 403,
      error: {
        type: SUPERVISORY_VISIT_ERRORS_TYPES.patientNotAssigned.value,
      },
    });
  }

  static templateNotFoundErr({customMessage} = {}) {
    return new AppError({
      message:
        customMessage ||
        'Checklist template not found or not available for supervisory visits',
      statusCode: 404,
      error: {
        type: SUPERVISORY_VISIT_ERRORS_TYPES.templateNotFound.value,
      },
    });
  }

  static assigneeNotInCareTeamErr({customMessage} = {}) {
    return new AppError({
      message:
        customMessage ||
        "The assigned nurse must be a nurse, administrator or case manager on the patient's care team",
      statusCode: 422,
      error: {
        type: SUPERVISORY_VISIT_ERRORS_TYPES.assigneeNotInCareTeam.value,
      },
    });
  }

  static caregiverNotInCareTeamErr({missingIds = [], customMessage} = {}) {
    return new AppError({
      message:
        customMessage ||
        'Every caregiver present must be an active caregiver of the patient',
      statusCode: 422,
      error: {
        type: SUPERVISORY_VISIT_ERRORS_TYPES.caregiverNotInCareTeam.value,
        details: {missingIds},
      },
    });
  }

  static invalidStatusTransitionErr({customMessage} = {}) {
    return new AppError({
      message:
        customMessage ||
        'This action is not allowed in the visit’s current status',
      statusCode: 409,
      error: {
        type: SUPERVISORY_VISIT_ERRORS_TYPES.invalidStatusTransition.value,
      },
    });
  }

  static forbiddenVisitActionErr({customMessage} = {}) {
    return new AppError({
      message:
        customMessage ||
        'You are not allowed to perform this action on this visit',
      statusCode: 403,
      error: {
        type: SUPERVISORY_VISIT_ERRORS_TYPES.forbiddenVisitAction.value,
      },
    });
  }

  static cannotReviewOwnFilingErr({customMessage} = {}) {
    return new AppError({
      message:
        customMessage ||
        'A visit cannot be reviewed by the person who filed it',
      statusCode: 403,
      error: {
        type: SUPERVISORY_VISIT_ERRORS_TYPES.cannotReviewOwnFiling.value,
      },
    });
  }

  static invalidScheduleErr({customMessage} = {}) {
    return new AppError({
      message: customMessage || 'The visit must end after it starts',
      statusCode: 422,
      error: {
        type: SUPERVISORY_VISIT_ERRORS_TYPES.invalidSchedule.value,
      },
    });
  }

  static tooManyEvidenceFilesErr({maxAllowed, customMessage} = {}) {
    return new AppError({
      message:
        customMessage || `At most ${maxAllowed} evidence files can be attached`,
      statusCode: 422,
      error: {
        type: SUPERVISORY_VISIT_ERRORS_TYPES.tooManyEvidenceFiles.value,
      },
    });
  }

  static tooManyQueuedFollowUpsErr({maxAllowed, customMessage} = {}) {
    return new AppError({
      message:
        customMessage ||
        `At most ${maxAllowed} follow-up tasks can be created from a visit at once`,
      statusCode: 422,
      error: {
        type: SUPERVISORY_VISIT_ERRORS_TYPES.tooManyQueuedFollowUps.value,
      },
    });
  }
};
