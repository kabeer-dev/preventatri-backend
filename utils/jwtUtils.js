const config = require('config');
const jwt = require('jsonwebtoken');

const {generalConstant} = require('../constants');
const {generateRandomString} = require('./general');
const {getTokenHeaderName} = require('./getTokenHeaderUtils');
const {secretKeyLength} = require('../constants/generalConstant');

module.exports.generateJwtSecretKey = ({additionalSecretKey = null} = {}) => {
  let secret = config.get('jwtPrivateKey');

  if (additionalSecretKey) secret = `${secret}-${additionalSecretKey}`;

  return secret;
};

module.exports.generateToken = ({
  payload,
  expiry,
  isRandomSecretKeyNeeded = false,
  tokenSecret = null,
}) => {
  let secretKey;

  if (isRandomSecretKeyNeeded && !tokenSecret)
    secretKey = generateRandomString({
      length: secretKeyLength,
    });
  else secretKey = tokenSecret;

  const secret = this.generateJwtSecretKey({additionalSecretKey: secretKey});

  const options = {expiresIn: expiry || generalConstant.tokenExpirationTime};

  const token = jwt.sign(payload, secret, options);

  return {token, secretKey};
};

module.exports.decodeToken = ({token}) => {
  try {
    return jwt.decode(token);
  } catch (error) {
    return false;
  }
};

module.exports.verifyToken = ({token, dbSecretKey = null}) => {
  try {
    const secret = this.generateJwtSecretKey({
      additionalSecretKey: dbSecretKey,
    });

    const decodedObj = jwt.verify(token, secret);

    return decodedObj;
  } catch (error) {
    return false;
  }
};

module.exports.getToken = ({cookieStr}) => {
  if (!cookieStr) return null;

  const cookies = cookieStr.split('; ').reduce((prev, current) => {
    const [name, ...value] = current.split('=');

    prev[name] = value.join('=');

    return prev;
  }, {});

  return cookies[getTokenHeaderName()];
};

/**
 * Centralized user token generator.
 * @param {Object} params
 * @param {Object} params.user - The user mongoose document instance
 * @param {'loginReset'|'verification'|'invitation'} params.type - Token type key in user.secretKeys
 * @param {Object} [params.payload] - Optional custom payload
 * @returns {String} token
 */
module.exports.generateUserToken = ({user, type, payload}) => {
  // Define expiry mapping
  const expiryMap = {
    loginReset: generalConstant.passwordResetTokenExpiry,
    verification: generalConstant.accountVerificationTokenExpiry,
    invitation: generalConstant.userInvitationTokenExpiry,
    accountUnlock: generalConstant.accountUnlockTokenExpiry,
  };

  const expiry = expiryMap[type];

  // Use 'id' for Prisma - wrap in user object for consistency with middleware expectations
  const userId = user.id;
  const tokenPayload = payload || {user: {id: userId, email: user.email}};

  const {token, secretKey} = this.generateToken({
    payload: tokenPayload,
    expiry,
    isRandomSecretKeyNeeded: true,
  });

  // For Prisma with JSON structure: Store the secretKey value in the secretKeys JSON object
  // Ensure secretKeys is initialized as an object
  if (!user.secretKeys || typeof user.secretKeys !== 'object') {
    user.secretKeys = {};
  }

  // Map token type to secretKeys field name
  const fieldMap = {
    auth: 'auth',
    otp: 'otp',
    verification: 'verification',
    invitation: 'invitation',
    loginReset: 'loginReset',
    accountUnlock: 'accountUnlock',
  };

  const secretKeyField = fieldMap[type];

  if (secretKeyField) {
    user.secretKeys[secretKeyField] = secretKey;
  }

  return token;
};
