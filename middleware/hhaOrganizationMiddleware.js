const {GeneralErrorsFactories} = require('../factories');
const HhaCredentialsServices = require('../services/hhaCredentialsServices');

/**
 * Lets the HHAeXchange routes through only for an organization that has
 * connected its own HHAeXchange credentials.
 *
 * Run after authMiddleware, which puts the verified token on the request.
 */
module.exports = async (req, res, next) => {
  const organizationId =
    req.extra?.jwtToken?.user?.currentActiveOrganization?.organizationId;

  const {success, isConnected, error} =
    await HhaCredentialsServices.isConnected({organizationId});

  // A failed lookup is an error, not a missing connection.
  if (!success) throw error;

  if (!isConnected) {
    throw GeneralErrorsFactories.forbiddenErr({
      customMessage: 'HHAeXchange is not connected for this organization.',
    });
  }

  next();
};
