const AppError = require('./app');

const {
  GENERAL_ERROR_TYPES,
} = require('../../constants/responses/errors/general');

module.exports = class GeneralErrorsFactories {
  static invalidTokenErr({customMessage} = {}) {
    return new AppError({
      message: customMessage || 'invalid token',
      error: {type: GENERAL_ERROR_TYPES.invalidToken.value},
      statusCode: 401,
    });
  }

  static badRequestErr({customMessage} = {}) {
    return new AppError({
      message: customMessage || 'bad request',
      error: {type: GENERAL_ERROR_TYPES.badRequest.value},
      statusCode: 400,
    });
  }
  static notFoundErr({customMessage} = {}) {
    return new AppError({
      message: customMessage || 'not found',
      error: {type: GENERAL_ERROR_TYPES.notFound.value},
      statusCode: 404,
    });
  }

  static forbiddenErr({customMessage} = {}) {
    return new AppError({
      message: customMessage || 'forbidden',
      error: {type: GENERAL_ERROR_TYPES.forbidden.value},
      statusCode: 403,
    });
  }

  static conflictErr({customMessage} = {}) {
    return new AppError({
      message: customMessage || 'conflict',
      error: {type: GENERAL_ERROR_TYPES.conflict.value},
      statusCode: 409,
    });
  }

  static internalErr({customMessage, statusCode} = {}) {
    return new AppError({
      message: customMessage || 'Something went wrong',
      statusCode: statusCode || 500,
      submitForMonitoring: true,
      error: {type: GENERAL_ERROR_TYPES.internalError.value},
    });
  }

  static missingObjectId() {
    return new AppError({
      message: 'ID missing. Please provide and id',
      error: {type: GENERAL_ERROR_TYPES.missingObjectId.value},
      statusCode: 400,
    });
  }

  static invalidObjectId() {
    return new AppError({
      message: 'ID invalid. Please provide a valid ID',
      error: {type: GENERAL_ERROR_TYPES.invalidObjectId.value},
      statusCode: 400,
    });
  }

  static tooManyRequestsErr() {
    return new AppError({
      message: 'Too many requests. You are temporarily blocked.',
      error: {type: GENERAL_ERROR_TYPES.temporarilyBlocked.value},
      statusCode: 500,
    });
  }

  static fileTypeNotAllowedErr({allowedTypes}) {
    return new AppError({
      message: `Please upload only files of type: ${allowedTypes}`,
      statusCode: 400,
      error: {type: GENERAL_ERROR_TYPES.fileTypeNotAllowed.value},
    });
  }
  static fileNotFoundErr() {
    return new AppError({
      message: `No file was uploaded. Please upload a file.`,
      statusCode: 400,
      error: {type: GENERAL_ERROR_TYPES.fileNotFound.value},
    });
  }

  static duplicateRecordErr({error}) {
    const duplicatedFields = Object.keys(error?.keyPattern || {});

    const fieldsList = duplicatedFields.join(', ');

    return new AppError({
      message: `Duplicate record found. Fields [${fieldsList}] must be unique.`,
      statusCode: 409,
      error: {
        type: GENERAL_ERROR_TYPES.duplicateRecord.value,
      },
    });
  }

  static accountInactiveErr() {
    return new AppError({
      message: 'Your account is inactive. Please contact your organization.',
      statusCode: 403,
      error: {type: GENERAL_ERROR_TYPES.accountInactive.value},
    });
  }

  static fromPrismaError({error}) {
    const {code, meta} = error;

    // Prisma 7 with @prisma/adapter-pg nests constraint info inside
    // meta.driverAdapterError.cause rather than on meta directly.
    const adapterCause = meta?.driverAdapterError?.cause;

    switch (code) {
      case 'P2002': {
        // Prisma 7 adapter: fields are in adapterCause.constraint.fields (quoted strings)
        // Older Prisma: fields are in meta.target (plain strings)
        const rawFields =
          adapterCause?.constraint?.fields || meta?.target || [];
        const fields = rawFields.map((f) => f.replace(/^"|"$/g, ''));

        return new AppError({
          message: `Duplicate record. Field(s) [${fields.join(', ')}] must be unique.`,
          statusCode: 409,
          error: {type: GENERAL_ERROR_TYPES.duplicateRecord.value},
        });
      }
      case 'P2003': {
        // Prisma 7 adapter: field name may be in adapterCause.constraint.field
        const field =
          adapterCause?.constraint?.field ||
          meta?.field_name ||
          meta?.constraint ||
          'related record';

        return new AppError({
          message: `Invalid reference: ${field} does not exist.`,
          statusCode: 400,
          error: {type: GENERAL_ERROR_TYPES.invalidReference.value},
        });
      }
      case 'P2025':
        return new AppError({
          message: 'Record not found.',
          statusCode: 404,
          error: {type: GENERAL_ERROR_TYPES.notFound.value},
        });
      case 'P2014':
        return new AppError({
          message: 'The change would violate a required relation.',
          statusCode: 400,
          error: {type: GENERAL_ERROR_TYPES.requiredRelationMissing.value},
        });
      case 'P2000':
        return new AppError({
          message: `Value too long${meta?.column_name ? ` for field '${meta.column_name}'` : ''}.`,
          statusCode: 400,
          error: {type: GENERAL_ERROR_TYPES.valueTooLong.value},
        });
      default:
        return null;
    }
  }

  static invalidPayload() {
    return new AppError({
      message: 'Invalid request payload. Please check your JSON syntax.',
      statusCode: 400,
      error: {type: GENERAL_ERROR_TYPES.invalidPayload.value},
    });
  }
};
