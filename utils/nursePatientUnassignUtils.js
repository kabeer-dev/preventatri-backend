/**
 * Nurse-Patient Unassignment Utilities
 * Pure helper for deciding which patients must lose a nurse assignment after
 * that nurse's region coverage changes.
 *
 * Kept separate from services (mirrors nurseRegionUtils.js) so the decision
 * logic can be unit-tested without a database.
 */

const {NURSE_REGION_ROLES} = require('../constants/nursesConstants');

/**
 * Pure planner for clearing stale patient nurse assignments.
 *
 * A patient's primary nurse must cover the patient's region with role PRIMARY,
 * and the secondary nurse with role SECONDARY. Given the nurse's NEW region
 * coverage, return the patients whose primary/secondary assignment is no longer
 * valid and must be nulled.
 *
 * A primary nurse HHAeXchange named is exempt: it assigns regardless of
 * region, and only the patient sync may change it.
 *
 * @param {object[]} patients         Patients assigned to this nurse. Each must
 *                                    expose id, isPrimaryNurseHhaManaged, primaryNurseProfileId,
 *                                    secondaryNurseProfileId and county.regionId.
 * @param {string}   nurseProfileId   The nurse whose regions just changed.
 * @param {Map}      nurseRegionMap   Map<regionId, nurseRegionRole> of the
 *                                    nurse's coverage AFTER the update.
 * @returns {{primaryPatientIds: string[], secondaryPatientIds: string[]}}
 */
function computeNursePatientUnassignPlan({
  patients,
  nurseProfileId,
  nurseRegionMap,
}) {
  const primaryPatientIds = [];
  const secondaryPatientIds = [];

  (patients || []).forEach((patient) => {
    const regionId = patient.county && patient.county.regionId;

    // Never null on missing region data.
    if (!regionId) return;

    const coveredRole = nurseRegionMap.get(regionId);

    if (
      patient.primaryNurseProfileId === nurseProfileId &&
      coveredRole !== NURSE_REGION_ROLES.PRIMARY &&
      !patient.isPrimaryNurseHhaManaged
    ) {
      primaryPatientIds.push(patient.id);
    }

    if (
      patient.secondaryNurseProfileId === nurseProfileId &&
      coveredRole !== NURSE_REGION_ROLES.SECONDARY
    ) {
      secondaryPatientIds.push(patient.id);
    }
  });

  return {primaryPatientIds, secondaryPatientIds};
}

module.exports = {computeNursePatientUnassignPlan};
