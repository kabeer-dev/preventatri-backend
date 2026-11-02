const config = require('config');

const {
  UsersErrorsFactories,
  UserSessionsResponsesFactories,
} = require('../factories');
const {SessionsServices} = require('../services');
const {safeMerge} = require('../utils');
const {getTokenHeaderName} = require('../utils/getTokenHeaderUtils');
const {getCookieDomain} = require('../utils/urlUtils');

module.exports = class SessionsController {
  static async getSessions(req, res, next) {
    const userId = req.extra.jwtToken.user.id;

    const {success, docs, error} =
      await SessionsServices.listActiveSessionsForUser({
        userId,
      });

    if (!success) throw error;

    return UserSessionsResponsesFactories.sessionsRetrieved({
      sessions: docs,
      currentSessionId: req.extra.jwtToken.sessionId,
    });
  }

  static async revokeSession(req, res, next) {
    const userId = req.extra.jwtToken.user.id;
    const {sessionId} = req.params;

    const {success, isDocumentDeleted, error} =
      await SessionsServices.deleteSessionById({id: sessionId, userId});

    if (!success) throw error;
    if (!isDocumentDeleted) throw UsersErrorsFactories.sessionNotFoundErr(); // Revoking the CURRENT session is allowed (it's how a user signs this
    // device out from its own list) — but don't let refreshTokenMiddleware
    // hand back a freshly-signed cookie for a session that was just
    // deleted. Clearing the cookie here mirrors what /logout does, and
    // clearing entities.user stops refreshTokenMiddleware from re-signing
    // at all (it no-ops when extractReqData finds no user).

    if (sessionId === req.extra.jwtToken.sessionId) {
      req.extra.entities.user = null;

      const BASE_URL = config.get('frontendURL');
      const cookieDomain = getCookieDomain({url: BASE_URL});
      const cookieName = getTokenHeaderName();

      res.clearCookie(
        cookieName,
        safeMerge({originalObj: {path: '/'}, newObj: {domain: cookieDomain}})
      );
    }

    return UserSessionsResponsesFactories.sessionRevoked();
  }

  static async signOutOtherDevices(req, res, next) {
    const userId = req.extra.jwtToken.user.id;
    const currentSessionId = req.extra.jwtToken.sessionId;

    const {error} = await SessionsServices.deleteOtherSessionsForUser({
      userId,
      currentSessionId,
    });

    if (error) throw error;

    return UserSessionsResponsesFactories.otherSessionsRevoked();
  }
};
