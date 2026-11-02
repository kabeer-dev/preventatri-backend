/**
 * HHAeXchange record -> PreventaTri Nurse mapping.
 *
 * A nurse is a GetNurses roster entry plus the GetCaregiverDemographics record
 * under the same id (NurseID === CaregiverID). The demographics record shares
 * the caregiver feed's names and nesting for the person, address, email and
 * discipline, so the caregiver readers apply; the roster supplies id and status.
 *
 * Pure functions only: no I/O, no Prisma, no config reads. Like caregiverMapper
 * this is the ONLY validation gate on the nurse sync path, so it is stricter
 * than the Postgres columns.
 *
 * A NurseProfile is a User satellite, so ONE record maps onto TWO tables and
 * mapHhaNurse returns `userFields` and `profileFields` separately.
 */

const {
  mapCaregiverFeedUserFields,
  readCaregiverFeedEmail,
} = require('./caregiverMapper');
const {omitCreateOnlyFields} = require('./createOnlyFieldUtils');
const {toTrimmed, toDate} = require('./fieldNormalizers');
const {buildHhaPlaceholderEmail} = require('./placeholderEmailUtils');
const {normalizeValue, unwrapArray} = require('./soapClient');
const {computeSyncHash} = require('./syncHashUtils');

const {
  HHAX_CAREGIVER_ELEMENTS,
  HHAX_CAREGIVER_DEMOGRAPHICS_ELEMENTS,
  HHAX_NURSE_ELEMENTS,
  HHAX_NURSE_ACTIVE_MAP,
  HHAX_DEFAULT_NURSE_STATUS,
  HHAX_PROFESSIONAL_ROLE_MAP,
  HHAX_DEFAULT_PROFESSIONAL_ROLE,
  HHAX_FIELD_MAX_LENGTHS,
  HHAX_SYNC_EXCEPTION_TYPES,
  HHAX_PLACEHOLDER_EMAIL_PREFIXES,
} = require('../../constants/hhaExchangeConstants');

/** Kept out of the hash and the hash-gated update -- see caregiverMapper. */
const CREATE_ONLY_NURSE_FIELDS = ['email'];

/** Moves for changes PreventaTri does not store -- see caregiverMapper. */
const NON_FINGERPRINT_NURSE_FIELDS = ['hhaModifiedDate'];

/** A National Provider Identifier is exactly ten digits. */
const NPI_PATTERN = /^\d{10}$/;

/**
 * EmploymentTypes > Discipline -> NurseProfile.professionalRole.
 *
 * Discipline is a REPEATED element, so it goes through unwrapArray. The first
 * discipline that maps onto the ProfessionalRole enum wins; a record with none
 * falls back and records an exception rather than being skipped, because the
 * roster has already said this person is a nurse.
 */
const mapProfessionalRole = ({employmentTypes, exceptions}) => {
  const disciplines = unwrapArray({
    value: employmentTypes?.[HHAX_CAREGIVER_ELEMENTS.DISCIPLINE],
  });

  const mapped = disciplines
    .map((discipline) => normalizeValue({value: discipline}))
    .filter((discipline) => discipline !== null)
    .map((discipline) => HHAX_PROFESSIONAL_ROLE_MAP[discipline.toLowerCase()])
    .find((role) => Boolean(role));

  if (!mapped) {
    exceptions.push({
      type: HHAX_SYNC_EXCEPTION_TYPES.UNMAPPED_PROFESSIONAL_ROLE,
      detail:
        disciplines.map((d) => normalizeValue({value: d})).join(', ') || null,
    });

    return HHAX_DEFAULT_PROFESSIONAL_ROLE;
  }

  return mapped;
};

/**
 * Roster Active -> NurseStatus. A "Yes"/"No" string; anything else falls back
 * and records an exception.
 */
const mapNurseStatus = ({active, exceptions}) => {
  const normalized = normalizeValue({value: active});

  const mapped =
    normalized === null
      ? null
      : HHAX_NURSE_ACTIVE_MAP[normalized.toLowerCase()];

  if (!mapped) {
    exceptions.push({
      type: HHAX_SYNC_EXCEPTION_TYPES.UNMAPPED_NURSE_STATUS,
      detail: normalized,
    });

    return HHAX_DEFAULT_NURSE_STATUS;
  }

  return mapped;
};

/**
 * NPInumber -> NurseProfile.npi.
 *
 * The column is VarChar(10) and the Yup schema insists on ten digits, so a
 * value HHAeXchange sends in any other shape stores null and records the raw
 * value -- writing it through would make every later admin PATCH fail
 * validation on a field the admin cannot edit.
 */
const mapNpi = ({npi, exceptions}) => {
  const normalized = normalizeValue({value: npi});

  if (normalized === null) return null;

  if (!NPI_PATTERN.test(normalized)) {
    exceptions.push({
      type: HHAX_SYNC_EXCEPTION_TYPES.INVALID_NPI,
      detail: normalized,
    });

    return null;
  }

  return normalized;
};

/**
 * Map one roster nurse and its demographics record onto User + NurseProfile.
 *
 * Returns `{hhaNurseId, userFields, profileFields, exceptions, isValid}`.
 * `isValid` is false when a NOT NULL column could not be filled.
 *
 * Both field groups contain ONLY HHAeXchange-owned values. licenseState,
 * licenseExpirationDate, regions, onCallIndicator, preferredContactMethod,
 * notes and joiningDate are PreventaTri-owned and deliberately absent, so an
 * update built from this can never clobber an admin's work.
 *
 * @param {Object} params
 * @param {Object} params.record - GetCaregiverDemographics CaregiverInfo node.
 * @param {Object} params.rosterEntry - The GetNurses node for the same person.
 */
const mapHhaNurse = ({record, rosterEntry}) => {
  const exceptions = [];

  const hhaNurseId = toTrimmed({
    value: rosterEntry?.[HHAX_NURSE_ELEMENTS.NURSE_ID],
    maxLength: HHAX_FIELD_MAX_LENGTHS.NURSE_ID,
  });

  const personFields = mapCaregiverFeedUserFields({record});
  const {firstName, lastName} = personFields;

  const userFields = Object.assign({}, personFields, {
    // Kept out of the hash-gated update; reconcileHhaEmails writes it.
    email: buildHhaPlaceholderEmail({
      email: readCaregiverFeedEmail({record}),
      prefix: HHAX_PLACEHOLDER_EMAIL_PREFIXES.NURSE,
      hhaId: hhaNurseId,
    }),
  });

  const profileFields = {
    professionalRole: mapProfessionalRole({
      employmentTypes: record[HHAX_CAREGIVER_ELEMENTS.EMPLOYMENT_TYPES],
      exceptions,
    }),
    status: mapNurseStatus({
      active: rosterEntry?.[HHAX_NURSE_ELEMENTS.ACTIVE],
      exceptions,
    }),
    licenseNumber: toTrimmed({
      value: record[HHAX_CAREGIVER_ELEMENTS.PROFESSIONAL_LICENSE_NUMBER],
      maxLength: HHAX_FIELD_MAX_LENGTHS.LICENSE_NUMBER,
    }),
    npi: mapNpi({
      npi: record[HHAX_CAREGIVER_DEMOGRAPHICS_ELEMENTS.NPI_NUMBER],
      exceptions,
    }),
    hhaModifiedDate: toDate({
      value: record[HHAX_CAREGIVER_DEMOGRAPHICS_ELEMENTS.LAST_MODIFIED_DATE],
    }),
  };

  const missingRequired = [];
  if (!firstName) missingRequired.push(HHAX_CAREGIVER_ELEMENTS.FIRST_NAME);
  if (!lastName) missingRequired.push(HHAX_CAREGIVER_ELEMENTS.LAST_NAME);

  if (missingRequired.length > 0) {
    exceptions.push({
      type: HHAX_SYNC_EXCEPTION_TYPES.MISSING_REQUIRED_FIELD,
      detail: missingRequired.join(', '),
    });
  }

  return {
    hhaNurseId,
    userFields,
    profileFields,
    exceptions,
    isValid: missingRequired.length === 0,
  };
};

/** Stable fingerprint of the HHAeXchange-owned nurse fields, both tables. */
const computeNurseSyncHash = ({userFields, profileFields}) =>
  computeSyncHash({
    mapped: Object.assign({}, userFields, profileFields),
    omitFields: CREATE_ONLY_NURSE_FIELDS.concat(NON_FINGERPRINT_NURSE_FIELDS),
  });

/** The subset of userFields an update may touch. */
const toUpdatableNurseUserFields = ({userFields}) =>
  omitCreateOnlyFields({
    fields: userFields,
    createOnlyFields: CREATE_ONLY_NURSE_FIELDS,
  });

module.exports = {
  CREATE_ONLY_NURSE_FIELDS,
  mapProfessionalRole,
  mapNurseStatus,
  mapNpi,
  mapHhaNurse,
  computeNurseSyncHash,
  toUpdatableNurseUserFields,
};
