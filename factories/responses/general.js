const AppResponse = require('./app');

const {
  GENERAL_SUCCESS_TYPES,
} = require('../../constants/responses/success/general');

module.exports = class GeneralResponsesFactories {
  static successResponse({message, statusCode, data, key, type}) {
    return new AppResponse({
      message: message,
      statusCode: statusCode,
      body: {[key]: data, type},
    });
  }

  static dataSavedSuccessfully({data, key}) {
    return this.successResponse({
      message: 'Data saved successfully',
      statusCode: 201,
      data,
      key,
      type: GENERAL_SUCCESS_TYPES.dataSavedSuccessfully.value,
    });
  }

  static dataRetrievedSuccessfully({data, key}) {
    return this.successResponse({
      message: 'Data retrieved successfully',
      statusCode: 200,
      data,
      key,
      type: GENERAL_SUCCESS_TYPES.dataRetrievedSuccessfully.value,
    });
  }

  static dataUpdatedSuccessfully({data, key}) {
    return this.successResponse({
      message: 'Data updated successfully',
      statusCode: 200,
      data,
      key,
      type: GENERAL_SUCCESS_TYPES.dataUpdatedSuccessfully.value,
    });
  }

  static dataDeletedSuccessfully({data, key}) {
    return this.successResponse({
      message: 'Data deleted successfully',
      statusCode: 200,
      data,
      key,
      type: GENERAL_SUCCESS_TYPES.dataDeletedSuccessfully.value,
    });
  }

  static invitedSuccessfully({entityType = 'User'} = {}) {
    return new AppResponse({
      message: `${entityType} invited successfully`,
      statusCode: 201,
      body: {type: GENERAL_SUCCESS_TYPES.invitedSuccessfully.value},
    });
  }
};
