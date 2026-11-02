const {SYSTEM_ROLES} = require('../constants/usersConstants');
const {GeneralErrorsFactories} = require('../factories');
const {NursesServices} = require('../services');

/**
 * Resolve the nurse's patient scope from the request token: the regions they
 * cover plus their user id (for patients assigned to them directly). Null when
 * the user is not a nurse. See buildNursePatientScopeClause.
 */
module.exports.resolveNurseScope = async ({token}) => {
  const userRole = token.user.currentActiveOrganization.role;

  if (userRole !== SYSTEM_ROLES.nurse.value) return null;

  const {success, docs: regionIds} =
    await NursesServices.getNurseRegionIdsByUserId({
      userId: token.user.id,
    });

  if (!success) {
    throw GeneralErrorsFactories.internalErr({
      customMessage: 'Failed to fetch nurse region assignments',
    });
  }

  return {regionIds: regionIds || [], userId: token.user.id};
};
