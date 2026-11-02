const AppError = require('./app');

const {
  REGION_ERRORS_TYPES,
} = require('../../constants/responses/errors/regions');

module.exports = class RegionsErrorsFactories {
  /**
   * Region-specific error: Already exists (by name or code)
   * Consolidates two similar errors into one flexible method
   *
   * Usage:
   * - regionAlreadyExistsErr({code}) → "Region with code 'XYZ' already exists..."
   * - regionAlreadyExistsErr({name}) → "Region with name 'ABC' already exists..."
   *
   * The error type in response changes based on which field caused the conflict:
   * - name provided → REGION_NAME_ALREADY_EXISTS
   * - code provided → REGION_CODE_ALREADY_EXISTS
   */
  static regionAlreadyExistsErr({name, code} = {}) {
    let fieldName, fieldValue, errorTypeKey;

    if (name) {
      fieldName = 'name';
      fieldValue = name;
      errorTypeKey = 'regionNameAlreadyExists';
    } else if (code) {
      fieldName = 'code';
      fieldValue = code;
      errorTypeKey = 'regionCodeAlreadyExists';
    }

    return new AppError({
      message: fieldValue
        ? `Region with ${fieldName} '${fieldValue}' already exists`
        : `Region ${fieldName} already exists`,
      statusCode: 409,
      error: {type: REGION_ERRORS_TYPES[errorTypeKey].value},
    });
  }

  /**
   * Region-specific error: Has nurses assigned
   * This is region-domain specific business logic
   */
  static regionHasNursesAssignedErr({nurseCount} = {}) {
    return new AppError({
      message: nurseCount
        ? `Cannot delete region with ${nurseCount} nurse(s) assigned. Please unassign nurses first.`
        : 'Cannot delete region with nurses assigned. Please unassign nurses first.',
      statusCode: 400,
      error: {type: REGION_ERRORS_TYPES.regionHasNursesAssigned.value},
    });
  }

  /**
   * Region-specific error: Has patients assigned
   */
  static regionHasPatientsAssignedErr({patientCount} = {}) {
    return new AppError({
      message: patientCount
        ? `Cannot delete region with ${patientCount} patient(s) assigned. Please reassign patients first.`
        : 'Cannot delete region with patients assigned. Please reassign patients first.',
      statusCode: 400,
      error: {type: REGION_ERRORS_TYPES.regionHasPatientsAssigned.value},
    });
  }

  /**
   * Region-specific error: Has case managers assigned
   */
  static regionHasCaseManagersAssignedErr({caseManagerCount} = {}) {
    return new AppError({
      message: caseManagerCount
        ? `Cannot delete region with ${caseManagerCount} case manager(s) assigned. Please unassign case managers first.`
        : 'Cannot delete region with case managers assigned. Please unassign case managers first.',
      statusCode: 400,
      error: {type: REGION_ERRORS_TYPES.regionHasCaseManagersAssigned.value},
    });
  }

  /**
   * Region-specific error: County already exists in organization
   * countyNames are display labels ("Washington, PA")
   */
  static countyNameAlreadyExistsErr({countyNames} = {}) {
    const nameList = countyNames?.length ? countyNames.join(', ') : 'provided';

    return new AppError({
      message: `County(ies) already exist in this organization: ${nameList}`,
      statusCode: 409,
      error: {type: REGION_ERRORS_TYPES.countyNameAlreadyExists.value},
    });
  }

  /**
   * Region-specific error: Failed to fetch regions
   */
  static failedToFetchRegionsErr() {
    return new AppError({
      message: 'Failed to fetch regions',
      statusCode: 503,
      error: {type: REGION_ERRORS_TYPES.failedToFetchRegions.value},
    });
  }

  /**
   * Region-specific error: Failed to fetch regions summary
   */
  static failedToFetchRegionsSummaryErr() {
    return new AppError({
      message: 'Failed to fetch regions summary',
      statusCode: 503,
      error: {type: REGION_ERRORS_TYPES.failedToFetchRegionsSummary.value},
    });
  }

  /**
   * Region-specific error: Failed to create region
   */
  static failedToCreateRegionErr() {
    return new AppError({
      message: 'Failed to create region',
      statusCode: 503,
      error: {type: REGION_ERRORS_TYPES.failedToCreateRegion.value},
    });
  }

  /**
   * Region-specific error: Failed to update region
   */
  static failedToUpdateRegionErr() {
    return new AppError({
      message: 'Failed to update region',
      statusCode: 503,
      error: {type: REGION_ERRORS_TYPES.failedToUpdateRegion.value},
    });
  }

  /**
   * Region-specific error: Failed to delete region
   */
  static failedToDeleteRegionErr() {
    return new AppError({
      message: 'Failed to delete region',
      statusCode: 503,
      error: {type: REGION_ERRORS_TYPES.failedToDeleteRegion.value},
    });
  }

  /**
   * Region-specific error: Failed to fetch nurses in region
   */
  static failedToFetchNursesInRegionErr() {
    return new AppError({
      message: 'Failed to fetch nurses in region',
      statusCode: 503,
      error: {type: REGION_ERRORS_TYPES.failedToFetchNursesInRegion.value},
    });
  }

  /**
   * Region-specific error: An assigned primary/secondary nurse is not eligible.
   * Reasons surfaced: not found in org, not ACTIVE, user not verified, soft-deleted,
   * or same nurse selected for both slots.
   */
  static invalidNurseForRegionErr({field, reason} = {}) {
    const fieldLabel = field || 'nurse';
    const reasonLabel = reason || 'is not eligible';

    return new AppError({
      message: `Invalid ${fieldLabel}: ${reasonLabel}`,
      statusCode: 400,
      error: {type: REGION_ERRORS_TYPES.invalidNurseForRegion.value},
    });
  }
};
