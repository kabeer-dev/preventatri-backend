/**
 * HHAeXchange record -> PreventaTri HhaVisit mapping.
 *
 * Pure functions only: no I/O, no Prisma, no config reads. Same contract as
 * patientMapper and caregiverMapper, and for the same reason -- this module is
 * the ONLY validation gate on the sync path, since background jobs never pass
 * through the Yup schemas that guard the HTTP routes.
 *
 * ONE HHAeXchange VISIT IS ONE ROW. In HHAeXchange a schedule and a visit are
 * the same record, so a single GetVisitChangesV5Info node carries both halves
 * and both land on one HhaVisit: the planned window (scheduledStartAt /
 * scheduledEndAt) and what actually happened (actualStartAt / actualEndAt /
 * evvStartAt / evvEndAt). The row is standalone -- it stores the HHAeXchange
 * patient and caregiver ids with a name snapshot and is never resolved against
 * PreventaTri's own patient or caregiver tables.
 *
 * TIMES ARE THE DELICATE PART. HHAeXchange sends a visit clock either as a full
 * local datetime or as a bare time-of-day that only means anything combined with
 * the record's VisitDate, and the zone it is expressed in arrives separately as
 * a word in TimeZone ("Eastern"). Both shapes are tried, the word is resolved
 * through HHAX_TIMEZONE_MAP, and the result is stored as a UTC instant. A value
 * that matches no format stores null rather than a guess -- a wrong visit time
 * is worse than a missing one.
 *
 * The default zone is a PARAMETER rather than a config read, so this module
 * keeps the pure-function contract its siblings declare. The runner passes
 * config hhax.syncTimezone.
 */

const {toTrimmed, toDate} = require('./fieldNormalizers');
const {normalizeValue} = require('./soapClient');
const {computeSyncHash} = require('./syncHashUtils');

const {parseFromFormats, toLuxonUTC} = require('../dateUtils');

const {
  HHAX_VISIT_ELEMENTS,
  HHAX_DELETED_VISIT_ELEMENTS,
  HHAX_VISIT_DATETIME_FORMATS,
  HHAX_VISIT_TIME_ONLY_FORMATS,
  HHAX_DATE_FORMATS,
  HHAX_MISSED_VISIT_MAP,
  HHAX_TIMEZONE_MAP,
  HHAX_VISIT_TYPE_MAP,
  HHAX_FIELD_MAX_LENGTHS,
  HHAX_SYNC_EXCEPTION_TYPES,
} = require('../../constants/hhaExchangeConstants');
const {HHA_VISIT_STATUSES} = require('../../constants/hhaVisitsConstants');

/**
 * hhaModifiedDate is excluded from the fingerprint for the same reason it is on
 * caregivers: HHAeXchange moves LastModifiedDate for edits to fields
 * PreventaTri does not store (billing, payroll, tasks performed), so including
 * it would send every visit down the write path on every run and defeat the
 * hash gate entirely. It is stored for display -- "when did the agency last
 * touch this?" -- not as the change signal.
 */
const NON_FINGERPRINT_VISIT_FIELDS = ['hhaModifiedDate'];

/** HHAeXchange's "unset date" sentinel year, shared with fieldNormalizers.toDate. */
const HHAX_UNSET_DATE_MAX_YEAR = 1900;

const MINUTES_PER_HOUR = 60;

/**
 * The IANA zone a visit's clock values are expressed in.
 *
 * A TimeZone HHAeXchange adds later falls back to the caller's default and
 * records an exception naming it -- which is how the real list gets discovered
 * rather than guessed at in the map. An ABSENT element is not an exception:
 * plenty of agencies run in one zone and never send it.
 */
const resolveVisitZone = ({value, defaultTimeZone, exceptions}) => {
  const normalized = normalizeValue({value});

  if (normalized === null) return defaultTimeZone;

  const mapped = HHAX_TIMEZONE_MAP[normalized.toLowerCase()];

  if (!mapped) {
    exceptions.push({
      type: HHAX_SYNC_EXCEPTION_TYPES.UNMAPPED_TIMEZONE,
      detail: normalized,
    });

    return defaultTimeZone;
  }

  return mapped;
};

/**
 * VisitType word -> the HhaVisitType enum, or null.
 *
 * visit_type is an enum column, so unlike the free-text fields around it an
 * unrecognised word CANNOT be stored. It becomes null plus an
 * UNMAPPED_VISIT_TYPE exception naming the word, exactly as resolveVisitZone
 * treats an unknown zone: the feed documents no domain for VisitType, so the
 * safe failure is one blank cell that names itself in the run summary rather
 * than a rejected write that loses the whole page.
 *
 * Inner whitespace is COLLAPSED, not stripped, so "Daily  Fixed" lands on the
 * same key as "Daily Fixed". "DailyFixed" keeps its own key and reaches the
 * same member only because HHAX_VISIT_TYPE_MAP carries the unspaced spelling
 * too -- a new spelling therefore belongs in the map, not in this normaliser.
 *
 * @param {Object} params
 * @param {*} params.value - Raw VisitType element value.
 * @param {Array} params.exceptions - Collector, appended to in place.
 * @returns {string|null} HhaVisitType member, or null when absent/unmapped.
 */
const resolveVisitType = ({value, exceptions}) => {
  const normalized = normalizeValue({value});

  if (normalized === null) return null;

  const key = normalized.toLowerCase().replace(/\s+/g, ' ').trim();
  const mapped = HHAX_VISIT_TYPE_MAP[key];

  if (!mapped) {
    exceptions.push({
      type: HHAX_SYNC_EXCEPTION_TYPES.UNMAPPED_VISIT_TYPE,
      detail: normalized,
    });

    return null;
  }

  return mapped;
};

/**
 * One visit clock value -> a UTC Date, or null.
 *
 * Two shapes are tried in order: a value that carries its own date, then a bare
 * time-of-day joined to the record's VisitDate. `zone` anchors both, so a
 * "09:00" visit in America/New_York stores as 13:00Z or 14:00Z depending on the
 * date -- which is precisely why the zone database does this rather than a
 * hard-coded offset.
 *
 * @param {Object} params
 * @param {*} params.value - Raw element value from the change feed.
 * @param {string|null} params.visitDate - Formatted yyyy-MM-dd, or null.
 * @param {string} params.zone - IANA zone name.
 * @returns {Date|null}
 */
const toVisitDateTime = ({value, visitDate, zone}) => {
  const normalized = normalizeValue({value});

  if (normalized === null) return null;

  const withOwnDate = parseFromFormats({
    value: normalized,
    formats: HHAX_VISIT_DATETIME_FORMATS,
    zone,
  });

  if (withOwnDate !== null) {
    // 1900-01-01 / 0001-01-01 are HHAeXchange's "unset" sentinels, on visit
    // clocks as on demographics.
    return withOwnDate.year <= HHAX_UNSET_DATE_MAX_YEAR
      ? null
      : withOwnDate.toUTC().toJSDate();
  }

  if (!visitDate) return null;

  const withVisitDate = parseFromFormats({
    value: `${visitDate} ${normalized}`,
    formats: HHAX_VISIT_TIME_ONLY_FORMATS,
    zone,
  });

  if (withVisitDate === null) return null;

  return withVisitDate.toUTC().toJSDate();
};

/**
 * IsMissedVisit -> boolean.
 *
 * The element is typed s:string, not s:boolean, so the spelling is whatever
 * HHAeXchange chose. An unrecognised NON-EMPTY value records an exception and
 * reads as NOT missed only after saying so out loud: silently treating an
 * unknown value as "the visit happened" is the one wrong answer that hides a
 * care gap.
 */
const mapMissedVisit = ({value, exceptions}) => {
  const normalized = normalizeValue({value});

  if (normalized === null) return false;

  const mapped = HHAX_MISSED_VISIT_MAP[normalized.toLowerCase()];

  if (mapped === undefined) {
    exceptions.push({
      type: HHAX_SYNC_EXCEPTION_TYPES.UNMAPPED_MISSED_VISIT,
      detail: normalized,
    });

    return false;
  }

  return mapped;
};

/**
 * MissedVisitReasonID -> `{reasonId, reason, unresolvedId}`.
 *
 * The id is ALWAYS returned when present; the text only on a hit. That split is
 * deliberate and live-driven: GetMissedVisitReasons is a master list that does
 * not cover every id the feed actually uses (2026-09-01, the list held 16 ids
 * and feed records carried one outside it), so a miss is the normal case rather
 * than an anomaly. Dropping the id on a miss would lose the only trace back to
 * the agency's own record.
 *
 * For the same reason no exception is recorded per record -- thousands of
 * visits sharing one unresolvable id would flood the summary and drown the
 * exceptions that mean something. The unresolved id is handed back instead, and
 * the runner reports the distinct set ONCE for the whole run.
 *
 * `reasonsById` is string-keyed, matching the parser, which leaves every leaf as
 * a string. A numeric key here would miss on every single record.
 *
 * Only consulted for a genuinely missed visit: HHAeXchange leaves the id
 * populated on some non-missed records, and resolving it there would attach a
 * reason to a visit that happened.
 */
const mapMissedReason = ({value, isMissedVisit, reasonsById}) => {
  if (!isMissedVisit) return {reasonId: null, reason: null, unresolvedId: null};

  const rawReasonId = normalizeValue({value});

  if (rawReasonId === null) {
    return {reasonId: null, reason: null, unresolvedId: null};
  }

  // missed_reason_id is INTEGER. A non-numeric id is not one, so it is dropped
  // rather than written through to fail the insert.
  const parsedReasonId = Number(rawReasonId);

  const reasonId = Number.isInteger(parsedReasonId) ? parsedReasonId : null;

  const reason = reasonsById[rawReasonId];

  if (!reason) {
    return {reasonId, reason: null, unresolvedId: rawReasonId};
  }

  return {
    reasonId,
    reason: toTrimmed({
      value: reason,
      maxLength: HHAX_FIELD_MAX_LENGTHS.MISSED_REASON,
    }),
    unresolvedId: null,
  };
};

/** The nested Patient / Caregiver block, or an empty object. */
const readNestedBlock = ({record, blockElement}) => {
  const block = record[blockElement];

  return block && typeof block === 'object' ? block : {};
};

/** The id child of a nested Patient / Caregiver block, or null. */
const readNestedId = ({record, blockElement}) =>
  normalizeValue({
    value: readNestedBlock({record, blockElement})[HHAX_VISIT_ELEMENTS.ID],
  });

/**
 * ScheduleDuration{Hours, Minutes} -> total minutes, or null when neither
 * child is numeric. Hours and minutes arrive as strings (parseTagValue is off).
 *
 * The absent check happens BEFORE the numeric conversion, deliberately:
 * normalizeValue answers null for a missing or blank child, and Number(null) is
 * 0, which Number.isFinite accepts. Converting first would therefore read a
 * ScheduleDuration block with no numeric children as a real zero-minute
 * duration and never return null at all.
 */
const toDurationMinutes = ({node}) => {
  if (!node || typeof node !== 'object') return null;

  const rawHours = normalizeValue({
    value: node[HHAX_VISIT_ELEMENTS.SCHEDULE_DURATION_HOURS],
  });

  const rawMinutes = normalizeValue({
    value: node[HHAX_VISIT_ELEMENTS.SCHEDULE_DURATION_MINUTES],
  });

  const hours = rawHours === null ? NaN : Number(rawHours);
  const minutes = rawMinutes === null ? NaN : Number(rawMinutes);

  const hasHours = Number.isFinite(hours);
  const hasMinutes = Number.isFinite(minutes);

  if (!hasHours && !hasMinutes) return null;

  return (hasHours ? hours : 0) * MINUTES_PER_HOUR + (hasMinutes ? minutes : 0);
};

/**
 * The feed-derived status. First match wins:
 *   missed                       -> MISSED
 *   an actual or EVV END exists  -> COMPLETED
 *   only a START exists          -> IN_PROGRESS (a clock-in with no clock-out)
 *   nothing yet                  -> SCHEDULED
 * DELETED is never produced here: it comes from the deleted-visit pass, and
 * the runner refuses to let a change-feed row overwrite it.
 *
 * A MISSED visit sends every time element empty (live-verified), so the order
 * only matters defensively.
 */
const deriveVisitStatus = ({
  isMissedVisit,
  actualStartAt,
  actualEndAt,
  evvStartAt,
  evvEndAt,
}) => {
  if (isMissedVisit) return HHA_VISIT_STATUSES.MISSED.value;

  if (actualEndAt || evvEndAt) return HHA_VISIT_STATUSES.COMPLETED.value;

  if (actualStartAt || evvStartAt) return HHA_VISIT_STATUSES.IN_PROGRESS.value;

  return HHA_VISIT_STATUSES.SCHEDULED.value;
};

/**
 * Map one GetVisitChangesV5Info record onto HhaVisit columns.
 *
 * Returns `{hhaVisitId, mapped, unresolvedMissedReasonId, exceptions, isValid}`.
 * `mapped` holds every HHAeXchange-owned column and nothing else -- the identity
 * (hhaVisitId) and the bookkeeping columns are added by the runner at write
 * time, exactly as the patient runner does.
 *
 * `isValid` is false when a NOT NULL column could not be filled. The caller
 * skips the record rather than letting the insert fail, so one bad row never
 * costs the rest of the page.
 *
 * @param {Object} params
 * @param {Object} params.record - One parsed GetVisitChangesV5Info node.
 * @param {Object} [params.reasonsById] - String-keyed missed-reason lookup.
 * @param {string} params.defaultTimeZone - IANA zone used when TimeZone is
 *   absent or unmapped.
 */
const mapHhaVisit = ({record, reasonsById = {}, defaultTimeZone}) => {
  const exceptions = [];

  const hhaVisitId = toTrimmed({
    value: record[HHAX_VISIT_ELEMENTS.VISIT_ID],
    maxLength: HHAX_FIELD_MAX_LENGTHS.VISIT_ID,
  });

  const patientBlock = readNestedBlock({
    record,
    blockElement: HHAX_VISIT_ELEMENTS.PATIENT,
  });

  const caregiverBlock = readNestedBlock({
    record,
    blockElement: HHAX_VISIT_ELEMENTS.CAREGIVER,
  });

  const zone = resolveVisitZone({
    value: record[HHAX_VISIT_ELEMENTS.TIME_ZONE],
    defaultTimeZone,
    exceptions,
  });

  // visit_date is a DATE column, so the calendar day is what matters and it is
  // read in UTC like every other HHAeXchange date. It doubles as the anchor for
  // the time-only clock values below, which ARE zone-sensitive.
  const rawVisitDate = normalizeValue({
    value: record[HHAX_VISIT_ELEMENTS.VISIT_DATE],
  });

  const visitDate = toDate({value: rawVisitDate});

  // Read back off the PARSED visitDate rather than re-parsed from the raw
  // value. A second format list here would silently fall behind toDate's: a
  // VisitDate shaped "2026-08-14 09:00" or "2026-08-14T09:00:00" parses fine
  // into visitDate but would miss the list, leaving this key null -- and a null
  // key nulls every bare clock value below, so a finished visit would be
  // reported as still SCHEDULED. UTC because that is the zone toDate read it
  // in. The visitDate guard is what keeps the unset-date sentinel null.
  const visitDateKey = visitDate
    ? toLuxonUTC({date: visitDate})?.toFormat(HHAX_DATE_FORMATS.DATE_ONLY) ||
      null
    : null;

  const readClock = ({element}) =>
    toVisitDateTime({value: record[element], visitDate: visitDateKey, zone});

  const isMissedVisit = mapMissedVisit({
    value: record[HHAX_VISIT_ELEMENTS.IS_MISSED_VISIT],
    exceptions,
  });

  const missedReason = mapMissedReason({
    value: record[HHAX_VISIT_ELEMENTS.MISSED_VISIT_REASON_ID],
    isMissedVisit,
    reasonsById,
  });

  const actualStartAt = readClock({
    element: HHAX_VISIT_ELEMENTS.VISIT_START_TIME,
  });
  const actualEndAt = readClock({element: HHAX_VISIT_ELEMENTS.VISIT_END_TIME});
  const evvStartAt = readClock({element: HHAX_VISIT_ELEMENTS.EVV_START_TIME});
  const evvEndAt = readClock({element: HHAX_VISIT_ELEMENTS.EVV_END_TIME});

  const mapped = {
    hhaPatientId: readNestedId({
      record,
      blockElement: HHAX_VISIT_ELEMENTS.PATIENT,
    }),
    hhaCaregiverId: readNestedId({
      record,
      blockElement: HHAX_VISIT_ELEMENTS.CAREGIVER,
    }),
    patientFirstName: toTrimmed({
      value: patientBlock[HHAX_VISIT_ELEMENTS.FIRST_NAME],
      maxLength: HHAX_FIELD_MAX_LENGTHS.NAME,
    }),
    patientLastName: toTrimmed({
      value: patientBlock[HHAX_VISIT_ELEMENTS.LAST_NAME],
      maxLength: HHAX_FIELD_MAX_LENGTHS.NAME,
    }),
    caregiverFirstName: toTrimmed({
      value: caregiverBlock[HHAX_VISIT_ELEMENTS.FIRST_NAME],
      maxLength: HHAX_FIELD_MAX_LENGTHS.NAME,
    }),
    caregiverLastName: toTrimmed({
      value: caregiverBlock[HHAX_VISIT_ELEMENTS.LAST_NAME],
      maxLength: HHAX_FIELD_MAX_LENGTHS.NAME,
    }),

    visitDate,
    visitType: resolveVisitType({
      value: record[HHAX_VISIT_ELEMENTS.VISIT_TYPE],
      exceptions,
    }),
    timeZone: toTrimmed({
      value: record[HHAX_VISIT_ELEMENTS.TIME_ZONE],
      maxLength: HHAX_FIELD_MAX_LENGTHS.TIME_ZONE,
    }),

    scheduledStartAt: readClock({
      element: HHAX_VISIT_ELEMENTS.SCHEDULE_START_TIME,
    }),
    scheduledEndAt: readClock({element: HHAX_VISIT_ELEMENTS.SCHEDULE_END_TIME}),
    scheduleDurationMinutes: toDurationMinutes({
      node: record[HHAX_VISIT_ELEMENTS.SCHEDULE_DURATION],
    }),

    actualStartAt,
    actualEndAt,
    evvStartAt,
    evvEndAt,
    clockInEvvType: toTrimmed({
      value: record[HHAX_VISIT_ELEMENTS.CLOCK_IN_EVV_TYPE],
      maxLength: HHAX_FIELD_MAX_LENGTHS.EVV_TYPE,
    }),
    clockOutEvvType: toTrimmed({
      value: record[HHAX_VISIT_ELEMENTS.CLOCK_OUT_EVV_TYPE],
      maxLength: HHAX_FIELD_MAX_LENGTHS.EVV_TYPE,
    }),

    isMissedVisit,
    missedReasonId: missedReason.reasonId,
    missedReason: missedReason.reason,

    status: deriveVisitStatus({
      isMissedVisit,
      actualStartAt,
      actualEndAt,
      evvStartAt,
      evvEndAt,
    }),

    hhaModifiedDate: toDate({
      value: record[HHAX_VISIT_ELEMENTS.LAST_MODIFIED_DATE],
    }),
  };

  const missingRequired = [];
  if (!hhaVisitId) missingRequired.push(HHAX_VISIT_ELEMENTS.VISIT_ID);
  if (!visitDate) missingRequired.push(HHAX_VISIT_ELEMENTS.VISIT_DATE);

  if (missingRequired.length > 0) {
    exceptions.push({
      type: HHAX_SYNC_EXCEPTION_TYPES.MISSING_REQUIRED_FIELD,
      detail: missingRequired.join(', '),
    });
  }

  return {
    hhaVisitId,
    mapped,

    // Reported once per run by the caller, never per record -- see
    // mapMissedReason.
    unresolvedMissedReasonId: missedReason.unresolvedId,
    exceptions,
    isValid: missingRequired.length === 0,
  };
};

/**
 * Stable fingerprint of the HHAeXchange-owned visit fields.
 *
 * @param {Object} params
 * @param {Object} params.mapped - The object returned by mapHhaVisit.
 * @returns {string} A 64-char sha256 hex digest, sized for hha_sync_hash.
 */
const computeVisitSyncHash = ({mapped}) =>
  computeSyncHash({mapped, omitFields: NON_FINGERPRINT_VISIT_FIELDS});

/**
 * Map one GetDeletedVisitsInfo record.
 *
 * Deliberately tiny: a deletion carries no schedule to reconcile, only the
 * identity of the visit that is not going to happen and why.
 *
 * @param {Object} params
 * @param {Object} params.record - One parsed GetDeletedVisitsInfo node.
 * @returns {{hhaVisitId, deletedAt, deletedReason}}
 */
const mapDeletedVisit = ({record}) => ({
  hhaVisitId: toTrimmed({
    value: record[HHAX_DELETED_VISIT_ELEMENTS.VISIT_ID],
    maxLength: HHAX_FIELD_MAX_LENGTHS.VISIT_ID,
  }),
  deletedAt: toDate({value: record[HHAX_DELETED_VISIT_ELEMENTS.DELETED_DATE]}),
  deletedReason: toTrimmed({
    value: record[HHAX_DELETED_VISIT_ELEMENTS.DELETED_REASON],
    maxLength: HHAX_FIELD_MAX_LENGTHS.DELETED_REASON,
  }),
});

module.exports = {
  resolveVisitZone,
  resolveVisitType,
  toVisitDateTime,
  mapMissedVisit,
  mapMissedReason,
  toDurationMinutes,
  deriveVisitStatus,
  mapHhaVisit,
  computeVisitSyncHash,
  mapDeletedVisit,
};
