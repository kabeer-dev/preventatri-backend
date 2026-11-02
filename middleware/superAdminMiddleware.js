const {SYSTEM_ROLES} = require('../constants/usersConstants');
const {GeneralErrorsFactories} = require('../factories');

/**
 * Lets only the super admin through. It does not scope queries to an
 * organization, because the super admin works across organizations.
 *
 * Run after authMiddleware, which puts the verified token on the request.
 */
module.exports = (req, res, next) => {
  const role =
    req.extra?.jwtToken?.user?.currentActiveOrganization?.role ?? null;

  if (role !== SYSTEM_ROLES.super_admin.value) {
    throw GeneralErrorsFactories.forbiddenErr();
  }

  next();
};
