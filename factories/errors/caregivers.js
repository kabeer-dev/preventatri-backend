const AppError = require('./app');

const {
  CAREGIVER_ERRORS_TYPES,
} = require('../../constants/responses/errors/caregivers');

module.exports = class CaregiversErrorsFactories {
  static invalidPatientAssignmentErr({customMessage} = {}) {
    return new AppError({
      message: customMessage || 'Invalid patient assignment',
      statusCode: 400,
      error: {type: CAREGIVER_ERRORS_TYPES.invalidPatientAssignment.value},
    });
  }

  static caregiverAlreadyExistsErr({customMessage} = {}) {
    return new AppError({
      message:
        customMessage || 'Caregiver profile already exists for this user',
      statusCode: 409,
      error: {type: CAREGIVER_ERRORS_TYPES.caregiverAlreadyExists.value},
    });
  }

  static caregiverHasActiveAssignmentsErr({customMessage} = {}) {
    return new AppError({
      message:
        customMessage || 'Cannot delete caregiver that has active assignments',
      statusCode: 409,
      error: {
        type: CAREGIVER_ERRORS_TYPES.caregiverHasActiveAssignments.value,
      },
    });
  }
};
