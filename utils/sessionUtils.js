const {cookieExpirationTime} = require('../constants/generalConstant');

module.exports.getSessionExpiresAt = () => {
  return new Date(Date.now() + cookieExpirationTime);
};
