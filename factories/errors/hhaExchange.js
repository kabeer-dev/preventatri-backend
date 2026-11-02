const AppError = require('./app');

const {
  HHA_EXCHANGE_ERRORS_TYPES,
} = require('../../constants/responses/errors/hhaExchange');

/**
 * Errors raised by the HHAeXchange integration.
 *
 * Deliberately separate from the per-entity factories: these describe the state
 * of the integration rather than of one record.
 *
 * hhaManagedFieldReadOnlyErr moved here from PatientsErrorsFactories when
 * caregivers joined the import. It is thrown from three places now -- the
 * patient update, the caregiver update and the caregiver's own profile update
 * -- and all three mean the same thing, so one factory beats three copies.
 */
module.exports = class HhaExchangeErrorsFactories {
  /**
   * A sync is already in flight. The lock is held in Redis and shared across
   * replicas, so this covers the nightly job and a button press colliding.
   */
  static syncAlreadyRunningErr({customMessage} = {}) {
    return new AppError({
      message:
        customMessage ||
        'A sync is already running. Wait for it to finish before starting another.',
      statusCode: 409,
      error: {type: HHA_EXCHANGE_ERRORS_TYPES.syncAlreadyRunning.value},
    });
  }

  static syncFailedErr({customMessage} = {}) {
    return new AppError({
      message: customMessage || 'HHAeXchange sync failed',
      statusCode: 502,
      error: {type: HHA_EXCHANGE_ERRORS_TYPES.syncFailed.value},
    });
  }

  /**
   * The queue would not accept the job, so no run exists. 503 rather than the
   * 502 above: nothing was asked of HHAeXchange, and the caller should retry.
   */
  static syncEnqueueFailedErr({customMessage} = {}) {
    return new AppError({
      message:
        customMessage ||
        'Could not start the HHAeXchange sync. Please try again.',
      statusCode: 503,
      error: {type: HHA_EXCHANGE_ERRORS_TYPES.syncEnqueueFailed.value},
      submitForMonitoring: true,
    });
  }

  /**
   * An edit touched a field HHAeXchange owns on an HHA-sourced record. Refused
   * rather than silently accepted, because the next sync would overwrite it and
   * the change would appear to have simply vanished.
   */
  static hhaManagedFieldReadOnlyErr({fields = [], customMessage} = {}) {
    return new AppError({
      message:
        customMessage ||
        `These fields are managed in HHAeXchange and cannot be edited here: ${fields.join(', ')}`,
      statusCode: 400,
      error: {
        type: HHA_EXCHANGE_ERRORS_TYPES.hhaManagedFieldReadOnly.value,
        fields,
      },
    });
  }

  static hhaVisitNotFoundErr({customMessage} = {}) {
    return new AppError({
      message: customMessage || 'HHAeXchange visit not found',
      statusCode: 404,
      error: {type: HHA_EXCHANGE_ERRORS_TYPES.hhaVisitNotFound.value},
    });
  }

  static syncRunNotFoundErr({customMessage} = {}) {
    return new AppError({
      message: customMessage || 'HHAeXchange sync run not found',
      statusCode: 404,
      error: {type: HHA_EXCHANGE_ERRORS_TYPES.syncRunNotFound.value},
    });
  }

  static syncExceptionNotFoundErr({customMessage} = {}) {
    return new AppError({
      message: customMessage || 'HHAeXchange sync exception not found',
      statusCode: 404,
      error: {type: HHA_EXCHANGE_ERRORS_TYPES.syncExceptionNotFound.value},
    });
  }

  static hhaEmailInUseErr({customMessage} = {}) {
    return new AppError({
      message:
        customMessage || 'Another user already logs in with this email address',
      statusCode: 409,
      error: {type: HHA_EXCHANGE_ERRORS_TYPES.hhaEmailInUse.value},
    });
  }

  /** The person accepted their invitation, so their login email is theirs now. */
  static hhaEmailLockedAfterOnboardingErr({customMessage} = {}) {
    return new AppError({
      message:
        customMessage ||
        'This person has already accepted their invitation, so their login email cannot be changed here',
      statusCode: 409,
      error: {
        type: HHA_EXCHANGE_ERRORS_TYPES.hhaEmailLockedAfterOnboarding.value,
      },
    });
  }

  /** The pick is not one of the patient's active HHAeXchange coordinators. */
  static hhaCoordinatorNotSelectableErr({customMessage} = {}) {
    return new AppError({
      message:
        customMessage ||
        'Choose one of the active coordinators HHAeXchange lists for this patient',
      statusCode: 400,
      error: {
        type: HHA_EXCHANGE_ERRORS_TYPES.hhaCoordinatorNotSelectable.value,
      },
    });
  }

  /** Only an open "county not set up" exception names a county to add. */
  static hhaCountyExceptionNotActionableErr({customMessage} = {}) {
    return new AppError({
      message:
        customMessage ||
        'This exception is not an open "county not set up" exception',
      statusCode: 409,
      error: {
        type: HHA_EXCHANGE_ERRORS_TYPES.hhaCountyExceptionNotActionable.value,
      },
    });
  }

  static hhaPrimaryNurseConflictNotFoundErr({customMessage} = {}) {
    return new AppError({
      message:
        customMessage ||
        'This patient has no open primary nurse conflict with HHAeXchange',
      statusCode: 404,
      error: {
        type: HHA_EXCHANGE_ERRORS_TYPES.hhaPrimaryNurseConflictNotFound.value,
      },
    });
  }

  static hhaPrimaryNurseChoiceRequiredErr({customMessage} = {}) {
    return new AppError({
      message:
        customMessage ||
        'Close a primary nurse conflict by choosing the PreventaTri or the HHAeXchange nurse',
      statusCode: 400,
      error: {
        type: HHA_EXCHANGE_ERRORS_TYPES.hhaPrimaryNurseChoiceRequired.value,
      },
    });
  }

  static hhaPrimaryNurseConflictNotReopenableErr({customMessage} = {}) {
    return new AppError({
      message:
        customMessage ||
        'This conflict has nothing left to choose; the sync reopens it if HHAeXchange and PreventaTri differ again',
      statusCode: 400,
      error: {
        type: HHA_EXCHANGE_ERRORS_TYPES.hhaPrimaryNurseConflictNotReopenable
          .value,
      },
    });
  }

  static hhaCaseManagerConflictNotFoundErr({customMessage} = {}) {
    return new AppError({
      message:
        customMessage ||
        'This patient has no open case manager conflict with HHAeXchange',
      statusCode: 404,
      error: {
        type: HHA_EXCHANGE_ERRORS_TYPES.hhaCaseManagerConflictNotFound.value,
      },
    });
  }

  static hhaCaseManagerChoiceRequiredErr({customMessage} = {}) {
    return new AppError({
      message:
        customMessage ||
        'Close a case manager conflict by choosing the current or the HHAeXchange case manager',
      statusCode: 400,
      error: {
        type: HHA_EXCHANGE_ERRORS_TYPES.hhaCaseManagerChoiceRequired.value,
      },
    });
  }

  static hhaCaseManagerConflictNotReopenableErr({customMessage} = {}) {
    return new AppError({
      message:
        customMessage ||
        'This conflict has nothing left to choose; change the case manager on the patient or the Coordinators view',
      statusCode: 400,
      error: {
        type: HHA_EXCHANGE_ERRORS_TYPES.hhaCaseManagerConflictNotReopenable
          .value,
      },
    });
  }
};
