const AppError = require('./app');

const {
  EMERGENCY_FLAG_ERRORS_TYPES,
} = require('../../constants/responses/errors/emergencyFlag');

module.exports = class EmergencyFlagErrorsFactories {
  static emergencyFlagNotFoundErr({customMessage} = {}) {
    return new AppError({
      message: customMessage || 'Emergency flag not found',
      statusCode: 404,
      error: {type: EMERGENCY_FLAG_ERRORS_TYPES.emergencyFlagNotFound.value},
    });
  }

  static maxImagesExceededErr({customMessage} = {}) {
    return new AppError({
      message:
        customMessage || 'Maximum of 5 images allowed per emergency flag',
      statusCode: 400,
      error: {type: EMERGENCY_FLAG_ERRORS_TYPES.maxImagesExceeded.value},
    });
  }

  static invalidImagesToRemoveErr({invalidKeys = []} = {}) {
    return new AppError({
      message: invalidKeys.length
        ? `The following image keys do not exist: ${invalidKeys.join(', ')}`
        : 'One or more image keys do not exist',
      statusCode: 400,
      error: {type: EMERGENCY_FLAG_ERRORS_TYPES.invalidImagesToRemove.value},
    });
  }

  static imageSizeExceededErr({customMessage} = {}) {
    return new AppError({
      message: customMessage || 'Each image must not exceed 5 MB',
      statusCode: 400,
      error: {type: EMERGENCY_FLAG_ERRORS_TYPES.imageSizeExceeded.value},
    });
  }

  static emergencyFlagNotVoidableErr({customMessage} = {}) {
    return new AppError({
      message: customMessage || 'Only pending emergency flags can be voided',
      statusCode: 400,
      error: {type: EMERGENCY_FLAG_ERRORS_TYPES.emergencyFlagNotVoidable.value},
    });
  }
};
