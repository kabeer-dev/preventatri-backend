const AppError = require('./app');

const {
  PATIENT_ERRORS_TYPES,
} = require('../../constants/responses/errors/patients');

module.exports = class PatientsErrorsFactories {
  static invalidCountyAssignmentErr({customMessage} = {}) {
    return new AppError({
      message: customMessage || 'Invalid county assignment',
      statusCode: 400,
      error: {type: PATIENT_ERRORS_TYPES.invalidCountyAssignment.value},
    });
  }

  static invalidCaregiverAssignmentErr({customMessage} = {}) {
    return new AppError({
      message: customMessage || 'Invalid caregiver assignment',
      statusCode: 400,
      error: {type: PATIENT_ERRORS_TYPES.invalidCaregiverAssignment.value},
    });
  }

  static invalidNurseAssignmentErr({customMessage} = {}) {
    return new AppError({
      message: customMessage || 'Invalid nurse assignment',
      statusCode: 400,
      error: {type: PATIENT_ERRORS_TYPES.invalidNurseAssignment.value},
    });
  }

  static invalidCaseManagerAssignmentErr({customMessage} = {}) {
    return new AppError({
      message: customMessage || 'Invalid case manager assignment',
      statusCode: 400,
      error: {type: PATIENT_ERRORS_TYPES.invalidCaseManagerAssignment.value},
    });
  }

  /**
   * Nurse assignment needs a region, and region is derived from the patient's
   * county. Without one, the region check would receive `undefined` — which
   * Prisma drops from the where clause, silently matching a nurse from ANY
   * region. Refusing is the only safe answer.
   */
  static missingCountyForNurseAssignmentErr({customMessage} = {}) {
    return new AppError({
      message:
        customMessage ||
        'Assign a county to this patient before assigning a nurse',
      statusCode: 400,
      error: {
        type: PATIENT_ERRORS_TYPES.missingCountyForNurseAssignment.value,
      },
    });
  }

  static unauthorizedPatientErr() {
    return new AppError({
      message: 'You are not assigned to this patient',
      statusCode: 403,
      error: {type: PATIENT_ERRORS_TYPES.unauthorizedPatient.value},
    });
  }
};
