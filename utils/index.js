const aclUtils = require('./aclUtils');
const auditLogFormatUtils = require('./auditLogFormatUtils');
const auditUtils = require('./auditUtils');
const bcryptUtils = require('./bcryptUtils');
const cronJobsUtils = require('./cronJobsUtils');
const databaseConnectionManager = require('./databaseConnectionManager');
const dateUtils = require('./dateUtils');
const expressUtils = require('./expressUtils');
const extraReqUtils = require('./extraReqUtils');
const fileUtils = require('./fileUtils');
const generalUtils = require('./general');
const hhaExchangeUtils = require('./hhaExchange');
const jwtUtils = require('./jwtUtils');
const otpUtils = require('./otpUtils');
const passwordsUtils = require('./passwordsUtils');
const {normalizePhoneNumber} = require('./phoneUtils');
const {wrapWithPrismaTransaction} = require('./prismaTransactionUtils');
const sessionUtils = require('./sessionUtils');
const socketUtils = require('./socketUtils');
const {enrichUserObject} = require('./userHelpers');
const userUtils = require('./userUtils');
const validatorUtils = require('./validatorUtils');

/* eslint-disable local-rules/no-spread-operator */
module.exports = {
  hhaExchangeUtils,
  cronJobsUtils,
  jwtUtils,
  validatorUtils,
  passwordsUtils,
  fileUtils,
  socketUtils,
  dateUtils,
  sessionUtils,
  aclUtils,
  auditLogFormatUtils,
  auditUtils,
  ...generalUtils,
  extraReqUtils,
  userUtils,
  otpUtils,
  bcryptUtils,
  expressUtils,
  enrichUserObject,
  databaseConnectionManager,
  wrapWithPrismaTransaction,
  normalizePhoneNumber,
};
