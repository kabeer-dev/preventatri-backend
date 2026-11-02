const AppResponse = require('./app');

const {NURSE_REGION_ROLES} = require('../../constants/nursesConstants');

const {
  REGION_SUCCESS_TYPES,
} = require('../../constants/responses/success/regions');
const {safeMerge} = require('../../utils/general');

module.exports = class RegionsResponsesFactories {
  // Region-specific response: list of regions
  static regionsListRetrieved({regions, meta}) {
    const body = safeMerge({
      originalObj: {
        regions,
        type: REGION_SUCCESS_TYPES.regionsListRetrieved.value,
      },
      newObj: meta ? {meta} : {},
    });

    return new AppResponse({
      message: 'Regions list retrieved successfully',
      statusCode: 200,
      body,
    });
  }

  // Region-specific response: summary of regions
  static regionsSummaryRetrieved({regionsSummary}) {
    return new AppResponse({
      message: 'Regions summary retrieved successfully',
      statusCode: 200,
      body: {
        regionsSummary,
        type: REGION_SUCCESS_TYPES.regionsSummaryRetrieved.value,
      },
    });
  }

  /**
   * Format a single nurse assignment for API response
   * Centralizes nurse-from-region formatting so any endpoint returning
   * nurses via region assignments uses the same shape.
   */
  static formatNurseAssignment({assignment}) {
    return {
      nurseProfileId: assignment.nurseProfile.id,
      userId: assignment.nurseProfile.userId,
      isPrimaryForRegion:
        assignment.nurseRegionRole === NURSE_REGION_ROLES.PRIMARY,
      assignedAt: assignment.assignedAt,
      user: assignment.nurseProfile.user,
      professionalRole: assignment.nurseProfile.professionalRole,
      status: assignment.nurseProfile.status,
    };
  }

  // Region-specific response: nurses in region
  static regionNursesRetrieved({region, nurseAssignments}) {
    const nurses = nurseAssignments.map((assignment) =>
      RegionsResponsesFactories.formatNurseAssignment({assignment})
    );

    return new AppResponse({
      message: 'Region nurses retrieved successfully',
      statusCode: 200,
      body: {
        regionNurses: {
          region: {
            id: region.id,
            name: region.name,
            code: region.code,
          },
          nurses,
          nurseCount: nurses.length,
        },
        type: REGION_SUCCESS_TYPES.regionNursesRetrieved.value,
      },
    });
  }
};
