/**
 * HHAeXchange record -> PreventaTri Caregiver mapping.
 *
 * Pure functions only: no I/O, no Prisma, no config reads. Like patientMapper,
 * this module is the ONLY validation gate on the caregiver sync path --
 * background jobs never pass through the Yup schemas that guard the HTTP routes
 * -- so it is deliberately stricter than the Postgres columns.
 *
 * The one structural difference from patients: a CaregiverProfile is a User
 * satellite, so ONE HHAeXchange record maps onto TWO tables. mapHhaCaregiver
 * therefore returns `userFields` and `profileFields` separately rather than one
 * flat object, and the reconciler writes both inside a single transaction.
 *
 * Fields HHAeXchange sends that PreventaTri has no home for -- SSN, ethnicity,
 * I-9, payroll, registry, referral, marital status, dependents, mobile ids,
 * licence/NPI, teams and branches -- are ignored by design. They are still
 * listed in HHAX_MASKED_FIELDS, because ignoring a field does not stop it
 * travelling through an error context on its way to a log sink.
 */

const {omitCreateOnlyFields} = require('./createOnlyFieldUtils');

const {
  toTrimmed,
  toPhone,
  toZipCode,
  toStateCode,
  toDate,
} = require('./fieldNormalizers');

const {
  buildHhaPlaceholderEmail,
  isPlaceholderEmail,
} = require('./placeholderEmailUtils');
const {normalizeValue, unwrapArray} = require('./soapClient');
const {computeSyncHash} = require('./syncHashUtils');

const {
  HHAX_CAREGIVER_DEMOGRAPHICS_ELEMENTS,
  HHAX_CAREGIVER_ELEMENTS,
  HHAX_DEMOGRAPHICS_REQUEST_ELEMENTS,
  HHAX_CAREGIVER_STATUS_MAP,
  HHAX_DEFAULT_CAREGIVER_STATUS,
  HHAX_DEFAULT_CAREGIVER_ROLE,
  HHAX_LANGUAGE_NAME_MAP,
  HHAX_FIELD_MAX_LENGTHS,
  HHAX_SYNC_EXCEPTION_TYPES,
  HHAX_PLACEHOLDER_EMAIL_PREFIXES,
} = require('../../constants/hhaExchangeConstants');

/**
 * Fields kept out of the hash and the hash-gated update. `email` is the login
 * identity: reconcileHhaEmails moves it separately, and only to a real address.
 */
const CREATE_ONLY_CAREGIVER_FIELDS = ['email'];

/**
 * Excluded from the fingerprint because it moves for changes PreventaTri does
 * not store. HHAeXchange bumps ModifiedDate when payroll, compliance or any of
 * the dozens of ignored fields change; hashing it would send every caregiver
 * down the write path on almost every run and defeat the point of hash gating.
 * It is still WRITTEN whenever a real change is detected, so it stays accurate
 * as "when the content we track last moved".
 */
const NON_FINGERPRINT_CAREGIVER_FIELDS = ['hhaModifiedDate'];

/**
 * HHAeXchange caregiver Status -> CaregiverStatus.
 *
 * Name-keyed, not id-keyed: the caregiver change feed sends Status as a string
 * ("On Leave"), where the patient feed sends a numeric StatusID.
 */
const mapCaregiverStatus = ({status, exceptions}) => {
  const normalized = normalizeValue({value: status});

  const mapped =
    normalized === null
      ? null
      : HHAX_CAREGIVER_STATUS_MAP[normalized.toLowerCase()];

  if (!mapped) {
    exceptions.push({
      type: HHAX_SYNC_EXCEPTION_TYPES.UNMAPPED_CAREGIVER_STATUS,
      detail: normalized,
    });

    return HHAX_DEFAULT_CAREGIVER_STATUS;
  }

  return mapped;
};

/**
 * EmploymentTypes > Discipline -> CaregiverProfile.role.
 *
 * `role` is the existing free-text caregiver-type column (it already holds
 * PCA / HHA / FAMILY), so the discipline lands there rather than in a second
 * column meaning the same thing.
 *
 * Discipline is a REPEATED element, so it goes through unwrapArray -- a
 * caregiver with one discipline arrives as a bare object, not an array. Only
 * the first is kept: `role` is a single value and the additional disciplines
 * have nowhere to go.
 *
 * The column is NOT NULL, so an empty block falls back rather than skipping the
 * record -- losing a real caregiver over a free-text field would be worse.
 */
const mapDiscipline = ({employmentTypes, exceptions}) => {
  const disciplines = unwrapArray({
    value: employmentTypes?.[HHAX_CAREGIVER_ELEMENTS.DISCIPLINE],
  });

  const first = disciplines
    .map((discipline) =>
      toTrimmed({value: discipline, maxLength: HHAX_FIELD_MAX_LENGTHS.ROLE})
    )
    .find((discipline) => discipline !== null);

  if (!first) {
    exceptions.push({
      type: HHAX_SYNC_EXCEPTION_TYPES.MISSING_DISCIPLINE,
      detail: null,
    });

    return HHAX_DEFAULT_CAREGIVER_ROLE;
  }

  return first;
};

/**
 * Language1 -> CaregiverProfile.language.
 *
 * Language1 is a numeric LanguageID, not a name, so it is resolved through the
 * agency's language master list (GetLanguages, read once per run) and then
 * mapped to the PreventaTri code the column stores and the UI renders.
 *
 * Languages 2-4 are deliberately dropped: PreventaTri has one language field.
 *
 * A name outside HHAX_LANGUAGE_NAME_MAP stores null and records the name, which
 * is how the agency's real language list gets discovered rather than guessed.
 */
const mapCaregiverLanguage = ({languageId, languageNamesById, exceptions}) => {
  const normalizedId = normalizeValue({value: languageId});

  if (normalizedId === null || Number(normalizedId) === 0) return null;

  const languageName = languageNamesById?.[normalizedId] || null;

  if (!languageName) {
    exceptions.push({
      type: HHAX_SYNC_EXCEPTION_TYPES.UNMAPPED_LANGUAGE,
      detail: normalizedId,
    });

    return null;
  }

  const code = HHAX_LANGUAGE_NAME_MAP[languageName.toLowerCase()];

  if (!code) {
    exceptions.push({
      type: HHAX_SYNC_EXCEPTION_TYPES.UNMAPPED_LANGUAGE,
      detail: languageName,
    });

    return null;
  }

  return code.slice(0, HHAX_FIELD_MAX_LENGTHS.LANGUAGE);
};

/**
 * The caregiver's login identity.
 *
 * The minting rule itself lives in placeholderEmailUtils -- it is identical for
 * caregivers and coordinators -- so this only binds the caregiver prefix to it.
 */
const buildCaregiverEmail = ({email, hhaCaregiverId}) =>
  buildHhaPlaceholderEmail({
    email,
    prefix: HHAX_PLACEHOLDER_EMAIL_PREFIXES.CAREGIVER,
    hhaId: hhaCaregiverId,
  });

/**
 * The `users` columns a caregiver-feed record carries, minus the email.
 *
 * Shared with the nurse mapper: HHAeXchange lists nurses inside the same feed
 * with the same Address block, so the person-level extraction is written once
 * here and each mapper only adds its own login identity on top.
 *
 * Street1 only -- Street2 is ignored, matching how the patient mapper ignores
 * Address2.
 *
 * @param {Object} params
 * @param {Object} params.record - One parsed GetCaregiverChangesV3Info node.
 * @returns {Object} firstName, lastName, address, city, state, zipCode, phoneNo.
 */
const mapCaregiverFeedUserFields = ({record}) => {
  const addressNode = record[HHAX_CAREGIVER_ELEMENTS.ADDRESS] || {};

  return {
    firstName: toTrimmed({
      value: record[HHAX_CAREGIVER_ELEMENTS.FIRST_NAME],
      maxLength: HHAX_FIELD_MAX_LENGTHS.NAME,
    }),
    lastName: toTrimmed({
      value: record[HHAX_CAREGIVER_ELEMENTS.LAST_NAME],
      maxLength: HHAX_FIELD_MAX_LENGTHS.NAME,
    }),
    address: toTrimmed({
      value: addressNode[HHAX_CAREGIVER_ELEMENTS.STREET_1],
      maxLength: HHAX_FIELD_MAX_LENGTHS.ADDRESS,
    }),
    city: toTrimmed({
      value: addressNode[HHAX_CAREGIVER_ELEMENTS.CITY],
      maxLength: HHAX_FIELD_MAX_LENGTHS.CITY,
    }),
    state: toStateCode({value: addressNode[HHAX_CAREGIVER_ELEMENTS.STATE]}),
    zipCode: toZipCode({value: addressNode[HHAX_CAREGIVER_ELEMENTS.ZIP_5]}),
    phoneNo:
      toPhone({value: addressNode[HHAX_CAREGIVER_ELEMENTS.HOME_PHONE]}) ||
      toPhone({value: addressNode[HHAX_CAREGIVER_ELEMENTS.PHONE_2]}),
  };
};

/**
 * The email element of a caregiver-feed record, raw. Shared with the nurse
 * mapper, which mints its own placeholder from it.
 */
const readCaregiverFeedEmail = ({record}) =>
  (record[HHAX_CAREGIVER_ELEMENTS.NOTIFICATION_PREFERENCES] || {})[
    HHAX_CAREGIVER_ELEMENTS.EMAIL
  ];

/**
 * Map one GetCaregiverChangesV3 record onto User + CaregiverProfile columns.
 *
 * Returns `{hhaCaregiverId, userFields, profileFields, exceptions, isValid}`.
 * `isValid` is false when a NOT NULL column could not be filled -- the caller
 * skips the record rather than letting the insert fail, so one bad row never
 * costs the rest of the page.
 *
 * Both field groups contain ONLY HHAeXchange-owned values.
 * relationshipToPatient, preferredContactMethod, notes, onCallIndicator and the
 * patient assignments are PreventaTri-owned and deliberately absent, so an
 * update built from this can never clobber an admin's work.
 *
 * @param {Object} params
 * @param {Object} params.record - One parsed GetCaregiverChangesV3Info node.
 * @param {Object} [params.languageNamesById] - LanguageID -> LanguageName.
 */
const mapHhaCaregiver = ({record, languageNamesById = {}}) => {
  const exceptions = [];

  const hhaCaregiverId = toTrimmed({
    value: record[HHAX_CAREGIVER_ELEMENTS.CAREGIVER_ID],
    maxLength: HHAX_FIELD_MAX_LENGTHS.CAREGIVER_ID,
  });

  const personFields = mapCaregiverFeedUserFields({record});
  const {firstName, lastName} = personFields;

  const userFields = Object.assign({}, personFields, {
    // Kept out of the hash-gated update; reconcileHhaEmails writes it.
    email: buildCaregiverEmail({
      email: readCaregiverFeedEmail({record}),
      hhaCaregiverId,
    }),
  });

  const profileFields = {
    role: mapDiscipline({
      employmentTypes: record[HHAX_CAREGIVER_ELEMENTS.EMPLOYMENT_TYPES],
      exceptions,
    }),
    status: mapCaregiverStatus({
      status: record[HHAX_CAREGIVER_ELEMENTS.STATUS],
      exceptions,
    }),
    language: mapCaregiverLanguage({
      languageId: record[HHAX_CAREGIVER_ELEMENTS.LANGUAGE_1],
      languageNamesById,
      exceptions,
    }),

    // HireDate is the caregiver's start with the agency, which is exactly what
    // the existing startDate column already means.
    startDate: toDate({value: record[HHAX_CAREGIVER_ELEMENTS.HIRE_DATE]}),
    terminationDate: toDate({
      value: record[HHAX_CAREGIVER_ELEMENTS.TERMINATED_DATE],
    }),
    hhaModifiedDate: toDate({
      value: record[HHAX_CAREGIVER_ELEMENTS.MODIFIED_DATE],
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
    hhaCaregiverId,
    userFields,
    profileFields,
    exceptions,
    isValid: missingRequired.length === 0,
  };
};

/**
 * A GetCaregiverDemographics record in the change feed's shape, so one mapper
 * serves both. Only the names that differ are translated.
 */
const toCaregiverFeedRecord = ({demographics}) => {
  const translated = {};

  translated[HHAX_CAREGIVER_ELEMENTS.CAREGIVER_ID] =
    demographics[HHAX_DEMOGRAPHICS_REQUEST_ELEMENTS.ID];

  translated[HHAX_CAREGIVER_ELEMENTS.STATUS] =
    demographics[HHAX_CAREGIVER_ELEMENTS.STATUS]?.[
      HHAX_CAREGIVER_DEMOGRAPHICS_ELEMENTS.STATUS_NAME
    ];

  translated[HHAX_CAREGIVER_ELEMENTS.LANGUAGE_1] =
    demographics[HHAX_CAREGIVER_DEMOGRAPHICS_ELEMENTS.LANGUAGE_ID_1];

  translated[HHAX_CAREGIVER_ELEMENTS.MODIFIED_DATE] =
    demographics[HHAX_CAREGIVER_DEMOGRAPHICS_ELEMENTS.LAST_MODIFIED_DATE];

  return Object.assign({}, demographics, translated);
};

/**
 * Stable fingerprint of the HHAeXchange-owned caregiver fields.
 *
 * Hashes BOTH field groups together, so a name change on `users` and a status
 * change on `caregiver_profiles` each move the fingerprint -- one record, one
 * hash, regardless of which table the change lands in.
 */
const computeCaregiverSyncHash = ({userFields, profileFields}) =>
  computeSyncHash({
    mapped: Object.assign({}, userFields, profileFields),
    omitFields: CREATE_ONLY_CAREGIVER_FIELDS.concat(
      NON_FINGERPRINT_CAREGIVER_FIELDS
    ),
  });

/**
 * The subset of userFields an update may touch.
 *
 * Thin binding over the shared filter, kept so the caregiver reconciler and the
 * caregiver's create-only list stay named together at the one call site.
 */
const toUpdatableUserFields = ({userFields}) =>
  omitCreateOnlyFields({
    fields: userFields,
    createOnlyFields: CREATE_ONLY_CAREGIVER_FIELDS,
  });

module.exports = {
  CREATE_ONLY_CAREGIVER_FIELDS,
  mapCaregiverFeedUserFields,
  readCaregiverFeedEmail,
  mapCaregiverStatus,
  mapDiscipline,
  mapCaregiverLanguage,
  buildCaregiverEmail,
  isPlaceholderEmail,
  mapHhaCaregiver,
  toCaregiverFeedRecord,
  computeCaregiverSyncHash,
  toUpdatableUserFields,
};
