module.exports.HHA_EXCHANGE_ERRORS_TYPES = {
  syncAlreadyRunning: {
    value: 'HHA_SYNC_ALREADY_RUNNING',
  },
  syncFailed: {
    value: 'HHA_SYNC_FAILED',
  },

  // HHAeXchange refused the credentials an admin tried to save.
  hhaCredentialsRejected: {
    value: 'HHA_CREDENTIALS_REJECTED',
  },

  // HHAeXchange did not answer, so the credentials could not be checked.
  hhaUnreachable: {
    value: 'HHA_UNREACHABLE',
  },

  // Distinct from syncFailed: the run never started, so nothing was imported
  // and retrying immediately is the right advice.
  syncEnqueueFailed: {
    value: 'HHA_SYNC_ENQUEUE_FAILED',
  },

  // Kept at the value PATIENT_ERRORS_TYPES used, so existing clients that
  // branch on the patient-side error type keep working after the move.
  hhaManagedFieldReadOnly: {
    value: 'HHA_MANAGED_FIELD_READ_ONLY',
  },

  hhaVisitNotFound: {
    value: 'HHA_VISIT_NOT_FOUND',
  },

  syncRunNotFound: {
    value: 'HHA_SYNC_RUN_NOT_FOUND',
  },

  syncExceptionNotFound: {
    value: 'HHA_SYNC_EXCEPTION_NOT_FOUND',
  },

  hhaEmailInUse: {
    value: 'HHA_EMAIL_IN_USE',
  },

  hhaEmailLockedAfterOnboarding: {
    value: 'HHA_EMAIL_LOCKED_AFTER_ONBOARDING',
  },

  hhaCoordinatorNotSelectable: {
    value: 'HHA_COORDINATOR_NOT_SELECTABLE',
  },
  hhaCountyExceptionNotActionable: {
    value: 'HHA_COUNTY_EXCEPTION_NOT_ACTIONABLE',
  },
  hhaPrimaryNurseConflictNotFound: {
    value: 'HHA_PRIMARY_NURSE_CONFLICT_NOT_FOUND',
  },
  hhaPrimaryNurseChoiceRequired: {
    value: 'HHA_PRIMARY_NURSE_CHOICE_REQUIRED',
  },
  hhaPrimaryNurseConflictNotReopenable: {
    value: 'HHA_PRIMARY_NURSE_CONFLICT_NOT_REOPENABLE',
  },
  hhaCaseManagerConflictNotFound: {
    value: 'HHA_CASE_MANAGER_CONFLICT_NOT_FOUND',
  },
  hhaCaseManagerChoiceRequired: {
    value: 'HHA_CASE_MANAGER_CHOICE_REQUIRED',
  },
  hhaCaseManagerConflictNotReopenable: {
    value: 'HHA_CASE_MANAGER_CONFLICT_NOT_REOPENABLE',
  },
};
