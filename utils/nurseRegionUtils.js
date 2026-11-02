/**
 * Nurse Region Utilities
 * Pure helpers for computing nurse-region assignment plans.
 *
 * Kept separate from services so the planning logic can be unit-tested
 * without a database and reused if other call sites need the same diff.
 */

const {NURSE_REGION_ROLES} = require('../constants/nursesConstants');

/**
 * Generic role-assignment planner shared by both edit directions (nurse→regions
 * and region→nurses). Given the current NurseRegion rows and the desired
 * primary/secondary id lists, returns the keys to delete, the assignments to
 * create, and the assignments whose role must change. The `keyField` selects
 * which side is being diffed (`regionId` or `nurseProfileId`). Undefined id
 * lists are left untouched (PATCH semantics); an empty array clears that role.
 *
 * All removals (computed from the ORIGINAL current roles) are applied before any
 * sets, so a cross-role move (e.g. SECONDARY → PRIMARY) is planned as a single
 * role update rather than a delete — important because the region edit form
 * always submits both lists.
 */
function computeRoleAssignmentPlan({
  currentRows,
  keyField,
  primaryIds,
  secondaryIds,
}) {
  const desiredAssignments = new Map(
    currentRows.map((row) => [row[keyField], row.nurseRegionRole])
  );

  const roleUpdates = [
    {role: NURSE_REGION_ROLES.PRIMARY, ids: primaryIds},
    {role: NURSE_REGION_ROLES.SECONDARY, ids: secondaryIds},
  ];

  // Phase 1: drop every current row whose role is being replaced (a provided
  // list fully replaces that role). Done first, from the original rows, so a
  // later role's set is not clobbered by an earlier role's removal.
  roleUpdates.forEach(({role, ids}) => {
    if (ids === undefined) return;

    currentRows
      .filter((row) => row.nurseRegionRole === role)
      .forEach((row) => desiredAssignments.delete(row[keyField]));
  });

  // Phase 2: apply the desired role for every provided id.
  roleUpdates.forEach(({role, ids}) => {
    if (ids === undefined) return;

    ids.forEach((id) => desiredAssignments.set(id, role));
  });

  const currentByKey = new Map(currentRows.map((row) => [row[keyField], row]));

  const toDelete = currentRows
    .filter((row) => !desiredAssignments.has(row[keyField]))
    .map((row) => row[keyField]);

  const toCreate = Array.from(desiredAssignments.entries())
    .filter(([key]) => !currentByKey.has(key))
    .map(([key, nurseRegionRole]) => ({[keyField]: key, nurseRegionRole}));

  const toUpdate = Array.from(desiredAssignments.entries())
    .filter(
      ([key, role]) =>
        currentByKey.has(key) && currentByKey.get(key).nurseRegionRole !== role
    )
    .map(([key, nurseRegionRole]) => ({[keyField]: key, nurseRegionRole}));

  return {toDelete, toCreate, toUpdate};
}

module.exports = {
  computeRoleAssignmentPlan,
};
