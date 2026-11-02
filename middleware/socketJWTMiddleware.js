const logger = require('./loggerMiddleware');
const SessionsServices = require('../services/sessionsServices');
const UsersServices = require('../services/usersServices');
const {decodeToken, verifyToken, getToken} = require('../utils/jwtUtils');

module.exports = async (socket, next) => {
  try {
    const token = getToken({cookieStr: socket.handshake.headers.cookie});

    if (!token) {
      logger.error('Socket cannot be authenticated: token is missing');

      return next(new Error('Socket cannot be authenticated'));
    }

    const decodedToken = decodeToken({token});
    const userId = decodedToken?.user?.id;
    const sessionId = decodedToken?.sessionId;

    if (!userId || !sessionId) {
      logger.error('Socket cannot be authenticated: token payload is invalid');

      return next(new Error('Socket cannot be authenticated'));
    }

    const {success, user, error} = await UsersServices.getUserById({
      id: userId,
      options: {
        fieldsInclusion: {
          include: ['secretKeys'],
        },
      },
    });

    const {success: sessionSuccess, doc: session} =
      await SessionsServices.getSessionById({id: sessionId, userId});

    if (!success || !user || !sessionSuccess || !session) {
      logger.error(error || 'Socket cannot be authenticated: user not found');

      return next(new Error('Socket cannot be authenticated'));
    }

    const decodedObj = verifyToken({
      token,
      dbSecretKey: session.secretKey,
    });

    if (decodedObj) {
      socket.userId = decodedObj?.user?.id;
      socket.organizationId =
        decodedObj?.user?.currentActiveOrganization?.organizationId;

      return next();
    }

    logger.error('Socket cannot be authenticated');

    return next(new Error('Socket cannot be authenticated'));
  } catch (error) {
    next(error);
  }
};
