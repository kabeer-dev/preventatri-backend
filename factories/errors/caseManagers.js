const AppError = require('./app');

const {
  CASE_MANAGER_ERRORS_TYPES,
} = require('../../constants/responses/errors/caseManagers');

module.exports = class CaseManagersErrorsFactories {
  static invalidRegionAssignmentErr({customMessage} = {}) {
    return new AppError({
      message: customMessage || 'Invalid region assignment for case manager',
      statusCode: 400,
      error: {type: CASE_MANAGER_ERRORS_TYPES.invalidRegionAssignment.value},
    });
  }

  static caseManagerAlreadyExistsErr({customMessage} = {}) {
    return new AppError({
      message:
        customMessage || 'Case manager profile already exists for this user',
      statusCode: 409,
      error: {type: CASE_MANAGER_ERRORS_TYPES.caseManagerAlreadyExists.value},
    });
  }

  static caseManagerHasAssignedPatientsErr({count}) {
    const patientLabel = count === 1 ? 'patient' : 'patients';

    return new AppError({
      message: `Cannot delete case manager with ${count} assigned ${patientLabel}. Please reassign patients first.`,
      statusCode: 400,
      error: {
        type: CASE_MANAGER_ERRORS_TYPES.caseManagerHasAssignedPatients.value,
      },
    });
  }

  static patientAlreadyAssignedErr({patientNames} = {}) {
    const names = patientNames?.length
      ? patientNames.join(', ')
      : 'One or more patients';

    return new AppError({
      message: `${names} ${patientNames?.length === 1 ? 'is' : 'are'} already assigned to another case manager`,
      statusCode: 409,
      error: {type: CASE_MANAGER_ERRORS_TYPES.patientAlreadyAssigned.value},
    });
  }
};
