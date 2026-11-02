/**
 * HHAeXchange record -> PreventaTri Case Manager mapping.
 *
 * HHAeXchange calls the role a Coordinator; PreventaTri calls it a Case
 * Manager. Same person, different word -- so this file speaks HHAeXchange
 * ("coordinator") because it reads the wire format, and everything it produces
 * lands on case_manager_profiles.
 *
 * Pure functions only: no I/O, no Prisma, no config reads. Like caregiverMapper,
 * this module is the ONLY validation gate on the coordinator sync path --
 * background jobs never pass through the Yup schemas that guard the HTTP routes
 * -- so it is deliberately stricter than the Postgres columns.
 *
 * Structurally it is the caregiver mapper's twin: a CaseManagerProfile is also a
 * User satellite, so ONE HHAeXchange record maps onto TWO tables and
 * mapHhaCoordinator returns `userFields` and `profileFields` separately.
 *
 * The one genuinely different shape, and the reason splitCoordinatorName exists:
 * CoordinatorInfo has a single `Name` element holding "First Last", where every
 * other HHAeXchange feed sends FirstName and LastName as separate elements.
 */

const {omitCreateOnlyFields} = require('./createOnlyFieldUtils');
const {toTrimmed} = require('./fieldNormalizers');
const {buildHhaPlaceholderEmail} = require('./placeholderEmailUtils');
const {normalizeValue} = require('./soapClient');
const {computeSyncHash} = require('./syncHashUtils');

const {
  HHAX_COORDINATOR_ELEMENTS,
  HHAX_COORDINATOR_ACTIVE_MAP,
  HHAX_DEFAULT_CASE_MANAGER_STATUS,
  HHAX_FIELD_MAX_LENGTHS,
  HHAX_SYNC_EXCEPTION_TYPES,
  HHAX_PLACEHOLDER_EMAIL_PREFIXES,
} = require('../../constants/hhaExchangeConstants');

/**
 * Kept out of the hash and the hash-gated update -- see caregiverMapper.
 */
const CREATE_ONLY_CASE_MANAGER_FIELDS = ['email'];

/**
 * A coordinator name reduced to a match key: whitespace collapsed, lowercased.
 * The patient feed names coordinators as text, so this is the join key.
 */
const normalizeCoordinatorName = ({name}) => {
  const normalized = normalizeValue({value: name});

  if (normalized === null) return null;

  const collapsed = normalized.replace(/\s+/g, ' ').trim().toLowerCase();

  return collapsed === '' ? null : collapsed;
};

/**
 * "First Last" -> {firstName, lastName}.
 *
 * CoordinatorInfo carries one `Name` element, not the FirstName/LastName pair
 * every other feed sends. Every sandbox coordinator is exactly two words with no
 * comma (checked 2026-09-03), but the split is written for the general case with
 * ONE deterministic rule: the FIRST word is the given name and everything after
 * it is the surname, so a three-word "Maria De Luca" keeps "De Luca" intact as
 * the surname. A double given name ("Mary Ann Smith") therefore lands as "Mary"
 * / "Ann Smith" -- a deliberate trade-off, because the feed carries no marker
 * that could tell the two shapes apart and compound surnames are the likelier
 * one for this roster.
 *
 * A single word is a first name with no surname -- User.lastName is nullable, so
 * it stores as null rather than duplicating the one word into both columns.
 */
const splitCoordinatorName = ({name}) => {
  const normalized = normalizeValue({value: name});

  if (normalized === null) return {firstName: null, lastName: null};

  const words = normalized.split(/\s+/).filter(Boolean);

  if (words.length === 0) return {firstName: null, lastName: null};

  if (words.length === 1) {
    return {
      firstName: toTrimmed({
        value: words[0],
        maxLength: HHAX_FIELD_MAX_LENGTHS.NAME,
      }),
      lastName: null,
    };
  }

  return {
    firstName: toTrimmed({
      value: words[0],
      maxLength: HHAX_FIELD_MAX_LENGTHS.NAME,
    }),
    lastName: toTrimmed({
      value: words.slice(1).join(' '),
      maxLength: HHAX_FIELD_MAX_LENGTHS.NAME,
    }),
  };
};

/**
 * Active -> CaseManagerStatus.
 *
 * A "Yes"/"No" string, not a status name and not a numeric id -- so the map is
 * two entries wide and the lookup lowercases first. Anything else falls back and
 * records an exception rather than skipping a real coordinator over a flag.
 */
const mapCoordinatorStatus = ({active, exceptions}) => {
  const normalized = normalizeValue({value: active});

  const mapped =
    normalized === null
      ? null
      : HHAX_COORDINATOR_ACTIVE_MAP[normalized.toLowerCase()];

  if (!mapped) {
    exceptions.push({
      type: HHAX_SYNC_EXCEPTION_TYPES.UNMAPPED_COORDINATOR_STATUS,
      detail: normalized,
    });

    return HHAX_DEFAULT_CASE_MANAGER_STATUS;
  }

  return mapped;
};

/**
 * Map one GetCoordinators record onto User + CaseManagerProfile columns.
 *
 * Returns `{hhaCoordinatorId, userFields, profileFields, exceptions, isValid}`.
 * `isValid` is false when a NOT NULL column could not be filled -- the caller
 * skips the record rather than letting the insert fail, so one bad row never
 * costs the rest of the roster.
 *
 * Both field groups contain ONLY HHAeXchange-owned values: the name and the
 * active flag, plus the email (see CREATE_ONLY_CASE_MANAGER_FIELDS). title, phoneNo, regions, patient
 * assignments, preferredContactMethod, language, startDate and notes are
 * PreventaTri-owned and deliberately absent, so an update built from this can
 * never clobber an admin's work. In particular the coordinator Description is
 * never read: an admin's title has to survive every run.
 *
 * @param {Object} params
 * @param {Object} params.record - One parsed CoordinatorInfo node.
 */
const mapHhaCoordinator = ({record}) => {
  const exceptions = [];

  const hhaCoordinatorId = toTrimmed({
    value: record[HHAX_COORDINATOR_ELEMENTS.COORDINATOR_ID],
    maxLength: HHAX_FIELD_MAX_LENGTHS.COORDINATOR_ID,
  });

  const rawName = record[HHAX_COORDINATOR_ELEMENTS.NAME];
  const {firstName, lastName} = splitCoordinatorName({name: rawName});

  const userFields = {
    firstName,
    lastName,

    // Kept out of the hash-gated update; reconcileHhaEmails writes it.
    email: buildHhaPlaceholderEmail({
      email: record[HHAX_COORDINATOR_ELEMENTS.EMAIL],
      prefix: HHAX_PLACEHOLDER_EMAIL_PREFIXES.CASE_MANAGER,
      hhaId: hhaCoordinatorId,
    }),
  };

  const profileFields = {
    status: mapCoordinatorStatus({
      active: record[HHAX_COORDINATOR_ELEMENTS.ACTIVE],
      exceptions,
    }),
  };

  // firstName backs a User row that must be identifiable. lastName is NOT
  // required -- the column is nullable and a one-word name is a real, if
  // unusual, record.
  if (!firstName) {
    exceptions.push({
      type: HHAX_SYNC_EXCEPTION_TYPES.MISSING_REQUIRED_FIELD,
      detail: HHAX_COORDINATOR_ELEMENTS.NAME,
    });
  }

  return {
    hhaCoordinatorId,
    userFields,
    profileFields,
    exceptions,
    isValid: Boolean(hhaCoordinatorId && firstName),
  };
};

/**
 * Stable fingerprint of the HHAeXchange-owned case manager fields.
 *
 * Hashes BOTH field groups together, so a name change on `users` and a status
 * change on `case_manager_profiles` each move the fingerprint -- one record, one
 * hash, regardless of which table the change lands in.
 *
 * Unlike the caregiver hash there is nothing to exclude beyond the create-only
 * email: GetCoordinators publishes no ModifiedDate, so there is no
 * vendor-managed timestamp that could move the hash on its own.
 */
const computeCoordinatorSyncHash = ({userFields, profileFields}) =>
  computeSyncHash({
    mapped: Object.assign({}, userFields, profileFields),
    omitFields: CREATE_ONLY_CASE_MANAGER_FIELDS,
  });

/** The subset of userFields an update may touch. */
const toUpdatableCaseManagerUserFields = ({userFields}) =>
  omitCreateOnlyFields({
    fields: userFields,
    createOnlyFields: CREATE_ONLY_CASE_MANAGER_FIELDS,
  });

module.exports = {
  CREATE_ONLY_CASE_MANAGER_FIELDS,
  normalizeCoordinatorName,
  splitCoordinatorName,
  mapCoordinatorStatus,
  mapHhaCoordinator,
  computeCoordinatorSyncHash,
  toUpdatableCaseManagerUserFields,
};
