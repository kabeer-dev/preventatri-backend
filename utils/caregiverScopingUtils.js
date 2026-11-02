const {SYSTEM_ROLES} = require('../constants/usersConstants');
const {GeneralErrorsFactories} = require('../factories');
const {CaregiversServices} = require('../services');

/**
 * Resolve the caregiver profile ID from the request token.
 * Returns the profile ID if the user is a caregiver, otherwise null.
 * Used to scope queries so caregivers only see their assigned resources.
 */
module.exports.resolveCaregiverProfileId = async ({token}) => {
  const userRole = token.user.currentActiveOrganization.role;

  if (userRole !== SYSTEM_ROLES.caregiver.value) return null;

  const {success, doc: profile} =
    await CaregiversServices.getCaregiverProfileByUser({
      userId: token.user.id,
    });

  if (!success || !profile) {
    throw GeneralErrorsFactories.internalErr({
      customMessage: 'Caregiver profile not found for the authenticated user',
      statusCode: 403,
    });
  }

  return profile.id;
};
