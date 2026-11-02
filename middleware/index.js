const authMiddleware = require(`./authMiddleware`);
const validatorMiddleware = require(`./validatorMiddleware`);
const errorMiddleware = require(`./errorMiddleware`);
const accessMiddleware = require('./accessMiddleware');
const aclAccessMiddleware = require('./aclAccessMiddleware');
const catchAsyncMiddleware = require('./catchAsyncMiddleware');
const ddosProtectionMiddleware = require('./ddosProtectionMiddleware');
const fileUploadMiddleware = require('./fileUploadMiddleware');
const finalResponseMiddleware = require('./finalResponseMiddleware');
const hhaOrganizationMiddleware = require('./hhaOrganizationMiddleware');
const idempotencyMiddleware = require('./idempotencyMiddleware');
const loggerMiddleware = require('./loggerMiddleware');
const parseMultipartFormFieldsMiddleware = require('./parseMultipartFormFieldsMiddleware');
const preparedObjectMiddleware = require('./preparedObjectMiddleware');
const refreshTokenMiddleware = require('./refreshTokenMiddleware');

const requestLoggerMiddleware = require('./requestLoggerMiddleware');
const setPlatformMiddleware = require('./setPlatformMiddleware');
const socketJWTMiddleware = require('./socketJWTMiddleware');
const superAdminMiddleware = require('./superAdminMiddleware');

const otpFlowMiddleware = require(`./otpFlowMiddleware`);

module.exports = {
  authMiddleware,
  validatorMiddleware,
  errorMiddleware,
  refreshTokenMiddleware,
  finalResponseMiddleware,
  logger: loggerMiddleware, // logger.error() sounds more appropriate than loggerMiddleware.error() IMO.
  accessMiddleware,
  catchAsyncMiddleware,
  preparedObjectMiddleware,
  ddosProtectionMiddleware,
  fileUploadMiddleware,
  socketJWTMiddleware,
  aclAccessMiddleware,
  idempotencyMiddleware,
  setPlatformMiddleware,
  otpFlowMiddleware,
  requestLoggerMiddleware,
  parseMultipartFormFieldsMiddleware,
  superAdminMiddleware,
  hhaOrganizationMiddleware,
};
