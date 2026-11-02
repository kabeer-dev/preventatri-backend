const config = require('config');

const {generalConstant} = require('../constants');
const SessionsServices = require('../services/sessionsServices');
const UsersServices = require('../services/usersServices');

const {
  jwtUtils,
  extraReqUtils,
  safeMerge,
  generateRandomString,
  sessionUtils,
} = require('../utils');
const {getPlatformsFlags} = require('../utils/extraReqUtils');
const {getTokenHeaderName} = require('../utils/getTokenHeaderUtils');
const {getCookieDomain} = require('../utils/urlUtils');
const {applySessionOrganization} = require('../utils/userHelpers');

const BASE_URL = config.get('frontendURL');
const platformHeader = config.get('platformHeader');

module.exports = async (req, res, next) => {
  try {
    if (req?.extra?.flags.needsToFetchUserInRefreshTokenMiddleware) {
      const {
        success: isSuccessful,
        user: retrievedUser,
        error: gettingUserErr,
      } = await UsersServices.getUserById({
        id: req?.extra?.entities?.user.id,
        options: {
          fieldsInclusion: {
            include: ['secretKeys', 'userOrganizations'],
          },
        },
      });

      if (!isSuccessful) throw gettingUserErr;

      // A user loaded again here would otherwise forget the organization the
      // session switched to, and the new token would carry the main one.
      req.extra.entities.user = applySessionOrganization({
        user: retrievedUser,
        session: req.extra.entities.session,
      });
    }

    const {user} = extraReqUtils.extractReqData({req});

    if (!user) return next();

    // A login creates its own session HERE rather than in the login
    // controller, because /login is called twice when OTP is required
    // (once to trigger it, once to verify it) and refreshTokenMiddleware
    // (a plain 3-arg middleware) is skipped by Express entirely whenever
    // an earlier middleware calls next(error) -- which is exactly what
    // happens on the OTP-required call and on a wrong-OTP retry. Creating
    // the session here means it is created if and only if the request
    // actually completes, so a phantom session per aborted attempt can't
    // happen.

    if (req.extra.flags.needsToCreateSession) {
      const {doc: createdSession, error: sessionErr} =
        await SessionsServices.createSession({
          userId: user.id,
          secretKey: generateRandomString({
            length: generalConstant.secretKeyLength,
          }),
          userAgent: req.headers['user-agent'] || null,
          ipAddress: req.ip || null,
          platform: req.headers[platformHeader],
          expiresAt: sessionUtils.getSessionExpiresAt(), // Set the session's expiration time to match the cookie expiration time
        });

      if (sessionErr) throw sessionErr;

      req.extra.entities.session = createdSession;
    }

    const {session, dbSecretKey} = extraReqUtils.extractReqData({req});

    if (!session) return next();

    // Sliding expiration: extend the session on every authenticated request.
    const {error: sessionUpdateErr} = await SessionsServices.renewSessionExpiry(
      {id: session.id}
    );

    if (sessionUpdateErr) throw sessionUpdateErr;

    const jwtTokenPayload = extraReqUtils.generateJWTTokenPayload({req});

    const {token} = jwtUtils.generateToken({
      payload: jwtTokenPayload,
      tokenSecret: dbSecretKey,
    });

    const {isWebsite} = getPlatformsFlags({flags: req.extra.flags});

    if (isWebsite) {
      const cookieDomain = getCookieDomain({url: BASE_URL});

      // Setting cookies
      const cookiesOpts = safeMerge({
        originalObj: {
          httpOnly: true,
          secure: true,
          sameSite: 'None',
          maxAge: generalConstant.cookieExpirationTime,
        },
        newObj: {domain: cookieDomain},
      });
      res.cookie(getTokenHeaderName(), token, cookiesOpts);
    } else {
      // For mobile, send the token in response body
      req.extra.appResponse.body.loginToken = token;
    }

    next();
  } catch (error) {
    next(error);
  }
};
