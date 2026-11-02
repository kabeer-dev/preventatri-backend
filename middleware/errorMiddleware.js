const config = require('config');

const logger = require('./loggerMiddleware');

const {GENERAL_ERROR_TYPES} = require('../constants/responses/errors/general');
const {GeneralErrorsFactories} = require('../factories');
const {finalizeResponse} = require('../utils/expressUtils');

const {
  checkErrorType,
  isPrismaKnownError,
  safeMerge,
} = require('../utils/general');
const {getTokenHeaderName} = require('../utils/getTokenHeaderUtils');
const {sendErrorTrace} = require('../utils/monitoring');
const {getCookieDomain} = require('../utils/urlUtils');

module.exports = (error, req, res, next) => {
  const BASE_URL = config.get('frontendURL');

  // Initialize req.extra if it doesn't exist (e.g., JSON parse errors happen before middleware setup)
  if (!req.extra) req.extra = {};

  //Special Case: Otp flow middleware add that flag to skip further processing if it's an OTP required response
  if (req.extra.flags?.isOtpResponse) {
    req.extra.appResponse = error;

    return finalizeResponse({req, res});
  }

  const {isAppError} = checkErrorType({error});

  // Only send to monitoring if error is unknown OR explicitly marked to submit
  const shouldSubmitForMonitoring =
    !isAppError || !error.isKnown || error.submitForMonitoring;

  if (shouldSubmitForMonitoring) {
    sendErrorTrace({error, source: 'expressErrorMiddleware', req});
    logger.error(error);
  }

  // Translate known Prisma errors (e.g. P2003 FK violation) into user-friendly
  // AppErrors so clients get a descriptive message instead of a generic 500.
  // Runs after monitoring above so the raw Prisma error is still traced.
  let mappedPrismaError = null;
  if (!isAppError && isPrismaKnownError({error})) {
    mappedPrismaError = GeneralErrorsFactories.fromPrismaError({error});
  }

  // Handle JSON parse errors with a user-friendly message
  if (error.type === 'entity.parse.failed') {
    error = GeneralErrorsFactories.invalidPayload();
  } else if (mappedPrismaError) {
    error = mappedPrismaError;
  } else if (!isAppError) {
    error = GeneralErrorsFactories.internalErr();
  }

  const cookieDomain = getCookieDomain({url: BASE_URL});

  if (error.internalErr?.type === GENERAL_ERROR_TYPES.invalidToken.value) {
    res.clearCookie(
      getTokenHeaderName(),
      safeMerge({
        originalObj: {
          httpOnly: true,
          secure: true,
          sameSite: 'None',
        },
        newObj: {domain: cookieDomain},
      })
    );
  }

  error.statusCode = error.statusCode || 500;
  error.status = error.status ?? 'error';

  error.message =
    error.statusCode === 500 ? 'Something went wrong' : error.message;

  const errData = {
    statusCode: error.statusCode,
    message: error.message,
    error: error.internalErr?.type ? error.internalErr : undefined,
  };

  req.extra.errResponse = errData;

  return finalizeResponse({req, res});
};
