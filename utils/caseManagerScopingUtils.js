const {SYSTEM_ROLES} = require('../constants/usersConstants');
const {GeneralErrorsFactories} = require('../factories');
const {CaseManagersServices} = require('../services');

/**
 * Resolve the case manager profile ID from the request token.
 * Returns the profile ID if the user is a case_manager, otherwise null.
 * Used to scope queries so case managers only see their assigned resources.
 */
module.exports.resolveCaseManagerProfileId = async ({token}) => {
  const userRole = token.user.currentActiveOrganization.role;

  if (userRole !== SYSTEM_ROLES.case_manager.value) return null;

  const {success, doc: profile} =
    await CaseManagersServices.getCaseManagerProfileByUser({
      userId: token.user.id,
    });

  if (!success || !profile) {
    throw GeneralErrorsFactories.internalErr({
      customMessage:
        'Case manager profile not found for the authenticated user',
      statusCode: 403,
    });
  }

  return profile.id;
};
