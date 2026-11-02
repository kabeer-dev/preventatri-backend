const {GeneralErrorsFactories} = require('../factories');

const {
  isHhaOrganization,
} = require('../utils/hhaExchange/hhaOrganizationUtils');

/**
 * Lets the HHAeXchange routes through only for the organization the
 * integration is connected to.
 *
 * Run after authMiddleware, which puts the verified token on the request.
 */
module.exports = (req, res, next) => {
  const organizationId =
    req.extra?.jwtToken?.user?.currentActiveOrganization?.organizationId;

  if (!isHhaOrganization({organizationId})) {
    throw GeneralErrorsFactories.forbiddenErr({
      customMessage: 'HHAeXchange is not connected for this organization.',
    });
  }

  next();
};
