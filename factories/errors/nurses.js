const AppError = require('./app');

const {NURSE_ERRORS_TYPES} = require('../../constants/responses/errors/nurses');

module.exports = class NursesErrorsFactories {
  /**
   * Nurse-specific error: Invalid region assignment
   * This is nurse-domain specific logic and should remain here
   * (NOT a generic "not found" error - it's about business rule validation)
   */
  static invalidRegionAssignmentErr({customMessage} = {}) {
    return new AppError({
      message: customMessage || 'Invalid region assignment',
      statusCode: 400,
      error: {type: NURSE_ERRORS_TYPES.invalidRegionAssignment.value},
    });
  }
};
