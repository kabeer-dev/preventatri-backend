// Single source of truth for how long an authenticated session stays valid.
// The JWT lifetime, the auth cookie and the presigned S3 URL TTL are all derived
// from it, so the window only has to be changed here.
const SESSION_TIMEOUT_MINUTES = 10;

module.exports = {
  tokenExpirationTime: `${SESSION_TIMEOUT_MINUTES}m`,
  cookieExpirationTime: SESSION_TIMEOUT_MINUTES * 60 * 1000,

  // S3 objects are private (Block Public Access). Every file URL handed to a
  // client is a presigned GET that expires with the session it was issued in.
  signedUrlExpireTimeInSeconds: SESSION_TIMEOUT_MINUTES * 60,

  passwordResetTokenExpiry: '30m', // 30 minutes
  accountVerificationTokenExpiry: '1h', // 1 hour
  userInvitationTokenExpiry: '1d',
  accountUnlockTokenExpiry: '30m', // 30 minutes
  maxFailedLoginAttempts: 5,
  secretKeyLength: 64,

  paginationDefaults: {
    limit: 25,
    page: 1,
  },
};

module.exports.OTP_EXPIRE_TIME_IN_SECONDS = 300;
module.exports.OTP_EXPIRE_TIME_IN_MINUTES = 5;
module.exports.OTP_REGENERATE_TIME_IN_SECONDS = 30;
module.exports.QUEUE_RATE_LIMIT_DELAY = 1000; // 1 second delay between queue items processing
module.exports.EMAIL_RATE_LIMIT_DELAY = 1000; // 1 seconds delay between sending emails

module.exports.TIME_ZONES = {
  utc: {
    value: 'utc',
  },
  eastern: {
    value: 'America/New_York',
    label: 'ET',
  },
};

module.exports.PLATFORMS = {
  web: {
    value: 'web',
  },
  mobile: {
    value: 'mobile',
  },
};

module.exports.TOKEN_TYPES = {
  loginReset: {
    value: 'loginReset',
  },
  verification: {
    value: 'verification',
  },
  invitation: {
    value: 'invitation',
  },
  accountUnlock: {
    value: 'accountUnlock',
  },
};

// Default per-user OTP method preferences, seeded onto the Security row
// created for every new user (see securityServices.createSecuritySettings).
module.exports.DEFAULT_OTP_METHODS = {email: true, phone: false};

// Default JSON structures for User model
// BENEFIT: Single source of truth for default secretKeys and otps structures
// USAGE: Prevents data loss when partially updating JSON fields - merge with existing values before writing to DB
// PREVENTS: Overwriting entire JSON objects and losing other keys (e.g., losing 'auth' when updating 'otp')
module.exports.DEFAULT_SECRET_KEYS = {
  auth: null,
  otp: null,
  verification: null,
  invitation: null,
  loginReset: null,
  accountUnlock: null,
};

module.exports.DEFAULT_OTPS = {
  email: null,
  phone: null,
};

// General statuses reusable across entities (nurses, caregivers, patients, etc.)
module.exports.ENTITY_STATUSES = {
  ACTIVE: {value: 'ACTIVE', label: 'Active'},
  INACTIVE: {value: 'INACTIVE', label: 'Inactive'},
};

module.exports.ENTITY_STATUSES_VALUES = Object.values(
  module.exports.ENTITY_STATUSES
).map((status) => status.value);

// General contact methods reusable across entities (nurses, caregivers, patients, etc.)
module.exports.PREFERRED_CONTACT_METHODS = {
  EMAIL: {value: 'email', label: 'Email'},
  PHONE: {value: 'phone', label: 'Phone'},
  SMS: {value: 'sms', label: 'SMS'},
};

// Sorting configuration - used by all list endpoints
module.exports.SORT_ORDERS = {
  asc: {value: 'asc'},
  desc: {value: 'desc'},
};

module.exports.SORT_ORDERS_VALUES = Object.values(
  module.exports.SORT_ORDERS
).map((order) => order.value);

module.exports.PREFERRED_CONTACT_METHODS_VALUES = Object.values(
  module.exports.PREFERRED_CONTACT_METHODS
).map((method) => method.value);
