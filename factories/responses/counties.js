const AppResponse = require('./app');

const {
  COUNTY_SUCCESS_TYPES,
} = require('../../constants/responses/success/counties');
const {safeMerge} = require('../../utils/general');

module.exports = class CountiesResponsesFactories {
  // County-specific response: list of counties
  static countiesListRetrieved({counties, meta}) {
    const body = safeMerge({
      originalObj: {
        counties,
        type: COUNTY_SUCCESS_TYPES.countiesListRetrieved.value,
      },
      newObj: meta ? {meta} : {},
    });

    return new AppResponse({
      message: 'Counties list retrieved successfully',
      statusCode: 200,
      body,
    });
  }
};
