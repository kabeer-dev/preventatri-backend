const {getTokenHeaderName} = require('./getTokenHeaderUtils');
const {PLATFORMS} = require('../constants/generalConstant');

module.exports.extractReqData = ({req}) => {
  const entities = req?.extra?.entities || {};

  const user = entities.user || null;
  const session = entities.session || null;
  const dbSecretKey = session?.secretKey || null;
  const sessionId = session?.id || null;

  return {
    user,
    session,
    dbSecretKey,
    sessionId,
    entities,
  };
};

module.exports.generateJWTTokenPayload = ({req}) => {
  const {user} = this.extractReqData({req});

  return {
    user: {
      id: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      currentActiveOrganization: user.currentActiveOrganization,
    },
    sessionId: req?.extra?.entities?.session?.id || null,
  };
};

/**
 * Extracts platform flags from the request headers.
 *
 * @param {Object} param - The request object containing platform flags.
 * @param {string} param.platformFlag - The platform flag.
 * @returns {Object} An object containing platform flags.
 */
module.exports.getPlatforms = ({platformFlag}) => {
  const isMobile = platformFlag === PLATFORMS.mobile.value;
  const isWebsite = platformFlag === PLATFORMS.web.value;

  return {isMobile, isWebsite};
};

/**
 *
 * @param {Object} param - The flags object containing platform flags.
 * @param {Object} param.flags - The flags object.
 * @returns {Object} An object containing platform flags.
 */
module.exports.getPlatformsFlags = ({flags}) => {
  const platformFlag = flags.platforms;

  return platformFlag;
};

/**
 *
 * @param {Object} param - The request object.
 * @param {Object} param.req - The request object.
 * @returns {string|null} The extracted token or null if not found.
 */
module.exports.extractTokenFromReqBasedOnPlatform = ({req}) => {
  const {isMobile} = this.getPlatformsFlags({flags: req.extra.flags});

  const token = isMobile
    ? req.headers['authorization']?.split(' ')[1]
    : req.cookies[getTokenHeaderName()];

  return token;
};
