const AppError = require('./app');

const {
  NON_ASSIGNABLE_PATIENT_STATUSES_LABEL_STRING,
} = require('../../constants/patientsConstants');

const {
  CHECKLIST_ASSIGNMENT_ERRORS_TYPES,
} = require('../../constants/responses/errors/checklistAssignment');

module.exports = class ChecklistAssignmentErrorsFactories {
  static assignmentNotFoundErr({customMessage} = {}) {
    return new AppError({
      message: customMessage || 'Checklist assignment not found',
      statusCode: 404,
      error: {
        type: CHECKLIST_ASSIGNMENT_ERRORS_TYPES.assignmentNotFound.value,
      },
    });
  }

  static duplicateActiveAssignmentErr({customMessage} = {}) {
    return new AppError({
      message:
        customMessage ||
        'An overlapping active checklist assignment already exists for this caregiver, patient, and template during the requested date range',
      statusCode: 409,
      error: {
        type: CHECKLIST_ASSIGNMENT_ERRORS_TYPES.duplicateActiveAssignment.value,
      },
    });
  }

  static submissionGraceExpiredErr({customMessage} = {}) {
    return new AppError({
      message:
        customMessage || 'The grace period for this submission has expired',
      statusCode: 400,
      error: {
        type: CHECKLIST_ASSIGNMENT_ERRORS_TYPES.submissionGraceExpired.value,
      },
    });
  }

  static templateNotFoundErr({customMessage} = {}) {
    return new AppError({
      message: customMessage || 'Checklist template not found',
      statusCode: 404,
      error: {
        type: CHECKLIST_ASSIGNMENT_ERRORS_TYPES.templateNotFound.value,
      },
    });
  }

  static patientNotAssignableErr({customMessage} = {}) {
    return new AppError({
      message:
        customMessage ||
        `Assignments cannot be created for ${NON_ASSIGNABLE_PATIENT_STATUSES_LABEL_STRING} patients`,
      statusCode: 400,
      error: {
        type: CHECKLIST_ASSIGNMENT_ERRORS_TYPES.patientNotAssignable.value,
      },
    });
  }

  static caregiverNotAssignableErr({customMessage} = {}) {
    return new AppError({
      message:
        customMessage ||
        'Assignments cannot be created for inactive or deleted caregivers',
      statusCode: 400,
      error: {
        type: CHECKLIST_ASSIGNMENT_ERRORS_TYPES.caregiverNotAssignable.value,
      },
    });
  }
};
