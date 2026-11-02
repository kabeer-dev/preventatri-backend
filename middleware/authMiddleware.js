const {ORGANIZATION_STATUSES} = require('../constants/organizationsConstants');
const {GeneralErrorsFactories} = require('../factories');

const SessionsServices = require('../services/sessionsServices');
const UsersServices = require('../services/usersServices');
const {extractTokenFromReqBasedOnPlatform} = require('../utils/extraReqUtils');
const jwtUtils = require('../utils/jwtUtils');

const {
  applySessionOrganization,
  buildProfileRelationsInclude,
  isRoleProfileInactive,
} = require('../utils/userHelpers');

module.exports = async (req, res, next) => {
  try {
    // 1. Extract token (header for mobile, cookie for web)
    const token = extractTokenFromReqBasedOnPlatform({req});

    if (!token) throw GeneralErrorsFactories.invalidTokenErr();

    // 2. Decode token to get user ID + session ID
    const decodedToken = jwtUtils.decodeToken({token});

    const userId = decodedToken?.user?.id;
    const sessionId = decodedToken?.sessionId;

    if (!userId || !sessionId) throw GeneralErrorsFactories.invalidTokenErr();

    // 3. Load the session this token was signed for. A missing row means
    // the session was revoked (or never existed) — this is what makes
    // revoking one device reject exactly that device's future requests
    // without touching any other session.
    const {success: sessionSuccess, doc: session} =
      await SessionsServices.getSessionById({id: sessionId, userId});

    if (!sessionSuccess || !session)
      throw GeneralErrorsFactories.invalidTokenErr();

    // 4. Get user's organizations and role profile statuses
    const {success, user, error} = await UsersServices.getUserById({
      id: userId,
      options: {
        fieldsInclusion: {
          include: Object.assign(
            {
              userOrganizations: {
                include: {organization: {select: {status: true}}},
              },
            },
            buildProfileRelationsInclude()
          ),
        },
      },
    });

    if (!success || !user) throw error;

    // The organization picked in the switcher belongs to this session.
    applySessionOrganization({user, session});

    // 5. Verify the token signature against this session's own secret
    const verifiedToken = jwtUtils.verifyToken({
      token,
      dbSecretKey: session.secretKey,
    });

    if (!verifiedToken) {
      await SessionsServices.deleteSessionById({id: sessionId, userId});
      throw GeneralErrorsFactories.invalidTokenErr();
    }

    // 5b. The org and role in the token are only trusted while the person still
    // holds an accepted membership there. Removing them from an organization
    // ends their sessions in it, even though their account lives on.
    const tokenOrganizationId =
      verifiedToken.user?.currentActiveOrganization?.organizationId;

    const tokenMembership = user.userOrganizations?.find(
      (membership) =>
        membership.organizationId === tokenOrganizationId && membership.isActive
    );

    if (tokenOrganizationId && !tokenMembership) {
      throw GeneralErrorsFactories.invalidTokenErr();
    }

    // A session also ends while its organization is not active.
    if (
      tokenMembership &&
      tokenMembership.organization?.status !==
        ORGANIZATION_STATUSES.ACTIVE.value
    ) {
      throw GeneralErrorsFactories.invalidTokenErr();
    }

    // 6. If the user's role profile (case manager / nurse / caregiver) was
    // marked inactive by an admin, force logout on the next request.
    const role = user.currentActiveOrganization?.role;
    if (role && isRoleProfileInactive({user, role}))
      throw GeneralErrorsFactories.invalidTokenErr();

    // 7. Attach user + session + token to req
    req.extra.entities.user = user;
    req.extra.entities.session = session;
    req.extra.jwtToken = verifiedToken;

    next();
  } catch (error) {
    throw GeneralErrorsFactories.invalidTokenErr();
  }
};
