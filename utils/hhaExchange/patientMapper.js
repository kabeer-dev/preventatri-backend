/**
 * HHAeXchange record -> PreventaTri Patient mapping.
 *
 * Pure functions only: no I/O, no Prisma, no config reads. That keeps the whole
 * mapping unit-testable against a captured fixture, which matters because this
 * module is the ONLY validation gate on the sync path -- background jobs never
 * pass through the Yup schemas that guard the HTTP routes.
 *
 * The value normalisers (toTrimmed, toPhone, toZipCode, toStateCode, toDate) and
 * the fingerprint now live in fieldNormalizers / syncHashUtils, shared with the
 * caregiver mapper. They are re-exported here so existing importers and tests
 * keep working. Their reason for being stricter than the Postgres columns is
 * unchanged and documented there:
 *  - Patient.gender is free-text VarChar(20) in Postgres, but the Yup update
 *    schema restricts it to GENDERS_VALUES. Writing a raw HHAeXchange value
 *    would make every later admin PATCH fail on a field the admin cannot edit.
 *  - Patient.state is VarChar(50) in Postgres but max(2) in Yup, with the same
 *    consequence.
 */

const {normalizeCoordinatorName} = require('./coordinatorMapper');

const {
  toTrimmed,
  toPhone,
  toZipCode,
  toStateCode,
  toDate,
} = require('./fieldNormalizers');
const {normalizeValue, unwrapArray} = require('./soapClient');
const {computeSyncHash} = require('./syncHashUtils');

const {
  HHA_COORDINATOR_NAME_MAX_LENGTH,
  HHAX_PATIENT_ELEMENTS,
  HHAX_PATIENT_NO_COORDINATOR_VALUE,
  HHAX_PATIENT_STATUS_MAP,
  HHAX_DEFAULT_PATIENT_STATUS,
  HHAX_GENDER_MAP,
  HHAX_FIELD_MAX_LENGTHS,
  HHAX_SYNC_EXCEPTION_TYPES,
} = require('../../constants/hhaExchangeConstants');
const {PATIENT_STATUSES} = require('../../constants/patientsConstants');

/** HHAeXchange Gender -> GENDERS value, or null with an exception recorded. */
const mapGender = ({value, exceptions}) => {
  const normalized = normalizeValue({value});

  if (normalized === null) return null;

  const mapped = HHAX_GENDER_MAP[normalized.toLowerCase()];

  if (!mapped) {
    exceptions.push({
      type: HHAX_SYNC_EXCEPTION_TYPES.UNMAPPED_GENDER,
      detail: normalized,
    });

    return null;
  }

  return mapped;
};

/**
 * StatusID -> PatientStatus. A DischargeDate wins outright: HHAeXchange only
 * populates it for genuinely discharged patients, and it is the more specific
 * signal of the two.
 */
const mapStatus = ({statusId, dischargeDate, exceptions}) => {
  if (toDate({value: dischargeDate}) !== null) {
    return PATIENT_STATUSES.DISCHARGED.value;
  }

  const normalized = normalizeValue({value: statusId});

  const mapped =
    normalized === null ? null : HHAX_PATIENT_STATUS_MAP[normalized];

  if (!mapped) {
    exceptions.push({
      type: HHAX_SYNC_EXCEPTION_TYPES.UNMAPPED_STATUS_ID,
      detail: normalized,
    });

    return HHAX_DEFAULT_PATIENT_STATUS;
  }

  return mapped;
};

/**
 * Map one GetPatientChangesV3 record onto Patient columns.
 *
 * Returns `{mapped, exceptions, isValid}`. `isValid` is false when a NOT NULL
 * column could not be filled — the caller skips the record rather than letting
 * the insert fail, so one bad row never stops the run.
 *
 * `mapped` contains ONLY HHAeXchange-owned fields. countyId, email, riskLevel,
 * notes, diagnoses and the nurse assignments are PreventaTri-owned and are
 * deliberately absent, so they cannot be clobbered by an update built from this.
 *
 * @param {Object} params
 * @param {Object} params.record - One parsed GetPatientChangesV3Info node.
 * @returns {{mapped: Object, exceptions: Object[], isValid: boolean}}
 */
const mapHhaPatient = ({record}) => {
  const exceptions = [];

  const firstName = toTrimmed({
    value: record[HHAX_PATIENT_ELEMENTS.FIRST_NAME],
    maxLength: HHAX_FIELD_MAX_LENGTHS.NAME,
  });

  const lastName = toTrimmed({
    value: record[HHAX_PATIENT_ELEMENTS.LAST_NAME],
    maxLength: HHAX_FIELD_MAX_LENGTHS.NAME,
  });

  const dateOfBirth = toDate({
    value: record[HHAX_PATIENT_ELEMENTS.DATE_OF_BIRTH],
  });

  const emergencyContactNode =
    record[HHAX_PATIENT_ELEMENTS.EMERGENCY_CONTACT_1] || {};

  const mapped = {
    firstName,
    lastName,
    dateOfBirth,
    gender: mapGender({
      value: record[HHAX_PATIENT_ELEMENTS.GENDER],
      exceptions,
    }),
    status: mapStatus({
      statusId: record[HHAX_PATIENT_ELEMENTS.STATUS_ID],
      dischargeDate: record[HHAX_PATIENT_ELEMENTS.DISCHARGE_DATE],
      exceptions,
    }),

    // Address1 only — Address2, CrossStreet and Notes are intentionally ignored.
    address: toTrimmed({
      value: record[HHAX_PATIENT_ELEMENTS.ADDRESS_1],
      maxLength: HHAX_FIELD_MAX_LENGTHS.ADDRESS,
    }),
    city: toTrimmed({
      value: record[HHAX_PATIENT_ELEMENTS.CITY],
      maxLength: HHAX_FIELD_MAX_LENGTHS.CITY,
    }),
    state: toStateCode({value: record[HHAX_PATIENT_ELEMENTS.STATE]}),
    zipCode: toZipCode({value: record[HHAX_PATIENT_ELEMENTS.ZIP_5]}),
    phoneNo:
      toPhone({value: record[HHAX_PATIENT_ELEMENTS.HOME_PHONE]}) ||
      toPhone({value: record[HHAX_PATIENT_ELEMENTS.PHONE_2]}),

    // The column is VarChar(20) and the Yup schema validates it as a phone
    // number — it holds the emergency contact's NUMBER, not their name.
    emergencyContact: toPhone({
      value: emergencyContactNode[HHAX_PATIENT_ELEMENTS.PHONE_1],
    }),
    medicaidId: toTrimmed({
      value: record[HHAX_PATIENT_ELEMENTS.MEDICAID_NUMBER],
      maxLength: HHAX_FIELD_MAX_LENGTHS.MEDICAID_ID,
    }),
  };

  const missingRequired = [];
  if (!firstName) missingRequired.push(HHAX_PATIENT_ELEMENTS.FIRST_NAME);
  if (!lastName) missingRequired.push(HHAX_PATIENT_ELEMENTS.LAST_NAME);
  if (!dateOfBirth) missingRequired.push(HHAX_PATIENT_ELEMENTS.DATE_OF_BIRTH);

  if (missingRequired.length > 0) {
    exceptions.push({
      type: HHAX_SYNC_EXCEPTION_TYPES.MISSING_REQUIRED_FIELD,
      detail: missingRequired.join(', '),
    });
  }

  return {mapped, exceptions, isValid: missingRequired.length === 0};
};

/**
 * The patient's HHA nurse. `isKnown: false` (element absent or unreadable) means
 * leave the link alone -- only a real NurseID <= 0 says "no nurse".
 *
 * @returns {{isKnown: boolean, hhaNurseId: string|null}}
 */
const readPatientNurseRef = ({record}) => {
  const normalized = normalizeValue({
    value: record[HHAX_PATIENT_ELEMENTS.NURSE_ID],
  });
  const numeric = Number(normalized);

  if (normalized === null || !Number.isInteger(numeric)) {
    return {isKnown: false, hhaNurseId: null};
  }

  return {isKnown: true, hhaNurseId: numeric > 0 ? String(numeric) : null};
};

/**
 * Every coordinator the feed names on the patient, in HHA's order. The element
 * is a repeated list of names; "0" marks an empty slot and is dropped.
 *
 * @returns {{isKnown: boolean, coordinators: {name: string, displayName: string}[]}}
 *   `name` is the match key, `displayName` what HHAeXchange sent.
 */
const readPatientCoordinatorRefs = ({record}) => {
  const node = record[HHAX_PATIENT_ELEMENTS.COORDINATORS];

  if (node === undefined) return {isKnown: false, coordinators: []};

  const coordinators = unwrapArray({
    value: node?.[HHAX_PATIENT_ELEMENTS.COORDINATOR],
  })
    .map((value) => normalizeValue({value}))
    .filter(
      (value) => value !== null && value !== HHAX_PATIENT_NO_COORDINATOR_VALUE
    )
    .map((value) => ({
      name: normalizeCoordinatorName({name: value}),
      displayName: toTrimmed({
        value,
        maxLength: HHA_COORDINATOR_NAME_MAX_LENGTH,
      }),
    }))
    .filter((coordinator) => coordinator.name);

  return {isKnown: true, coordinators};
};

/**
 * Stable fingerprint of the HHAeXchange-owned patient fields.
 *
 * Delegates to the shared computeSyncHash so patients and caregivers fingerprint
 * identically. Kept as a named export because it reads at the call site as the
 * patient counterpart of mapHhaPatient.
 *
 * @param {Object} params
 * @param {Object} params.mapped - The object returned by mapHhaPatient.
 * @returns {string} A 64-char sha256 hex digest, sized for hha_sync_hash.
 */
const computePatientSyncHash = ({mapped}) => computeSyncHash({mapped});

module.exports = {
  toTrimmed,
  toPhone,
  toZipCode,
  toStateCode,
  toDate,
  mapGender,
  mapStatus,
  mapHhaPatient,
  readPatientNurseRef,
  readPatientCoordinatorRefs,
  computePatientSyncHash,
};
