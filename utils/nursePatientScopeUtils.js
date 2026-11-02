/**
 * The patients a nurse may see: those in a region the nurse covers, plus any
 * they are the primary or secondary nurse of -- HHAeXchange assigns nurses
 * regardless of region.
 *
 * Pure, and apart from nurseScopingUtils because services use it and that
 * module requires the services index.
 *
 * @param {Object} params
 * @param {{regionIds: string[], userId: string}} params.nurseScope
 * @returns {Object} A Patient where clause.
 */
module.exports.buildNursePatientScopeClause = ({nurseScope}) => ({
  OR: [
    {county: {regionId: {in: nurseScope.regionIds}}},
    {primaryNurse: {userId: nurseScope.userId}},
    {secondaryNurse: {userId: nurseScope.userId}},
  ],
});
