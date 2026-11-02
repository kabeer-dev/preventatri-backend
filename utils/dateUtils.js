const {DateTime} = require('luxon');

const {TIME_ZONES} = require('../constants/generalConstant');

// Function to get the current date and time
function getCurrentDateTime() {
  return DateTime.now().toISO();
}

/**
 * Returns the current date as a native JS Date (UTC)
 * Use this for schema validation and DB writes
 */
function currentDate() {
  return DateTime.now().toJSDate();
}

function getCurrentYear() {
  return DateTime.now().year;
}

// Function to format a date to a specific format
function formatDate({date, format = 'yyyy-MM-dd'}) {
  return DateTime.fromISO(date).toFormat(format);
}
function isValidDate({date}) {
  return DateTime.fromISO(date).isValid;
}

function getCurrentTimeInSeconds({zone = TIME_ZONES.utc.value} = {}) {
  return Math.floor(DateTime.now().setZone(zone).toSeconds());
}

/**
 * Normalizes different date inputs into a UTC ISO string.
 *
 * @param {Date | DateTime | string} date
 * @returns {string | undefined}
 * All values are converted through Luxon and returned as a UTC ISO string
 * to ensure consistent timezone handling and safe database storage.
 */
function normalizeToISO({date}) {
  if (!date) return undefined;

  let dt;

  if (date instanceof Date) {
    dt = DateTime.fromJSDate(date);
  } else if (DateTime.isDateTime(date)) {
    dt = date;
  } else if (typeof date === 'string') {
    dt = DateTime.fromISO(date);
  }

  if (!dt || !dt.isValid) return undefined;

  return dt.toUTC().toISO();
}

/**
 * Returns today's date as a JS Date at midnight UTC (no time component).
 * Use for date comparisons and filters.
 */
function getToday() {
  return DateTime.utc().startOf('day').toJSDate();
}

/**
 * Returns the current date+time as a JS Date (UTC).
 * Use when saving timestamps — e.g. submittedAt, createdAt.
 */
function getCurrentTime() {
  return DateTime.utc().toJSDate();
}

/**
 * Returns a JS Date representing N days from now, at start of day (UTC).
 * Use for date-range filters — time is stripped to avoid partial-day exclusions.
 * Pass isStartOfDay false for an exact rolling window from the current time.
 */
function getDaysFromNow({days, isStartOfDay = true}) {
  const now = DateTime.utc();

  return (isStartOfDay ? now.startOf('day') : now).plus({days}).toJSDate();
}

/**
 * Converts a date value (JS Date, ISO string, or Luxon DateTime) to a UTC Luxon DateTime.
 */
function toLuxonUTC({date}) {
  if (DateTime.isDateTime(date)) {
    return date.toUTC();
  }
  if (date instanceof Date) {
    return DateTime.fromJSDate(date).toUTC();
  }
  if (typeof date === 'string') {
    // Parse in UTC, not the server's local zone. A date-only string like
    // '2026-07-20' would otherwise be read as local midnight and shifted to the
    // previous UTC day on servers ahead of UTC (e.g. PKT/UTC+5), truncating the
    // window by a day. `zone: 'utc'` keeps the calendar date intact; strings
    // that carry their own offset are still honoured.
    return DateTime.fromISO(date, {zone: 'utc'});
  }

  return null;
}

/**
 * Returns today's date as a Luxon DateTime at midnight UTC (date-only).
 */
function todayUTC() {
  return DateTime.utc().startOf('day');
}

/**
 * Builds a Prisma date-range where-clause on the given field from optional
 * from/to bounds (each normalized to a UTC ISO string). Returns {} when
 * neither bound is provided, so callers can merge the result into any query
 * unconditionally — the shared "all time by default" pattern for stats
 * endpoints.
 *
 * Example: buildDateRangeClause({from, to}) → {createdAt: {gte, lte}} | {}
 */
function buildDateRangeClause({from, to, field = 'createdAt'}) {
  const fromISO = normalizeToISO({date: from});
  const toISO = normalizeToISO({date: to});

  const conditions = Object.assign(
    {},
    fromISO ? {gte: fromISO} : {},
    toISO ? {lte: toISO} : {}
  );

  return Object.keys(conditions).length ? {[field]: conditions} : {};
}

/**
 * Extracts the date portion (YYYY-MM-DD) from an ISO string, ignoring time and timezone,
 * and returns a JS Date at midnight UTC for that date.
 *
 * Example: "2026-03-28T00:00:00.000+05:00" → 2026-03-28T00:00:00.000Z (not 2026-03-27)
 */
function toDateOnlyUTC({date}) {
  if (!date || typeof date !== 'string') return null;

  return DateTime.fromISO(date.slice(0, 10), {zone: 'utc'}).toJSDate();
}

/**
 * Returns the number of days between two date values (to - from), interpreting
 * both bounds in UTC. Accepts ISO date strings (e.g. YYYY-MM-DD). Use for
 * date-range span checks so day boundaries are computed deterministically
 * regardless of the server timezone.
 */
function getDaysBetween({from, to}) {
  return DateTime.fromISO(to, {zone: TIME_ZONES.utc.value}).diff(
    DateTime.fromISO(from, {zone: TIME_ZONES.utc.value}),
    'days'
  ).days;
}

/**
 * Parses a value against an ordered list of explicit Luxon format strings and
 * returns the first that matches, as a Luxon DateTime (or null if none do).
 *
 * Use when a source mixes several date shapes inside one payload and a single
 * permissive parse would silently mis-read one of them. Parsing is anchored to
 * `zone` (UTC by default) rather than the server's local zone, so a date-only
 * or offset-less value keeps its calendar date instead of shifting a day on
 * servers ahead of or behind UTC.
 */
function parseFromFormats({value, formats = [], zone = TIME_ZONES.utc.value}) {
  if (typeof value !== 'string') return null;

  const trimmed = value.trim();

  if (trimmed === '') return null;

  for (const format of formats) {
    const parsed = DateTime.fromFormat(trimmed, format, {zone});

    if (parsed.isValid) return parsed;
  }

  return null;
}

/**
 * Current time as epoch milliseconds (UTC).
 *
 * Use for elapsed-time measurement and for stamping a token, so no caller has
 * to reach for Date.now() directly.
 */
function getEpochMillis() {
  return DateTime.utc().toMillis();
}

/**
 * Current time as a UTC ISO string, with the trailing Z.
 *
 * Distinct from getCurrentDateTime, which returns the server's LOCAL zone plus
 * its offset. Use this whenever the timestamp leaves the process -- an API
 * response, a log line, a run summary -- so the value cannot be misread
 * depending on where the server happens to run.
 */
function getCurrentUTCISO() {
  return DateTime.utc().toISO();
}

/**
 * Formats "N days before now" in UTC using an explicit Luxon format string.
 *
 * Use when an external API dictates the exact shape of a lower-bound
 * timestamp rather than accepting a plain ISO string.
 */
function getUTCDaysAgoFormatted({days, format}) {
  return DateTime.utc().minus({days}).toFormat(format);
}

/**
 * Shift an already-formatted UTC value forward and hand it back in the same
 * format. Used to advance a feed cursor whose wire format must be preserved
 * exactly (the HHAeXchange visit feed rejects any other serialisation).
 *
 * @param {Object} params
 * @param {string} params.value - A value produced with `format`.
 * @param {string} params.format - Luxon format token string.
 * @param {Object} params.duration - Luxon duration object, e.g. {days: 14}.
 * @returns {string|null} Null when `value` does not match `format`.
 */
function addToFormattedUTC({value, format, duration}) {
  const parsed = parseFromFormats({value, formats: [format]});

  if (parsed === null) return null;

  return parsed.plus(duration).toFormat(format);
}

/**
 * Current time as a Luxon DateTime in the given zone (UTC by default).
 */
function nowInZone({zone = TIME_ZONES.utc.value} = {}) {
  return DateTime.now().setZone(zone);
}

function getDayRangeInZone({date = DateTime.utc(), zone}) {
  const zoned = toLuxonUTC({date}).setZone(zone);

  return {
    start: zoned.startOf('day').toJSDate(),
    end: zoned.endOf('day').toJSDate(),
  };
}

/**
 * Whole minutes from `from` to `to` (positive when `to` is later).
 */
function getMinutesBetween({from, to}) {
  return Math.round(
    toLuxonUTC({date: to}).diff(toLuxonUTC({date: from}), 'minutes').minutes
  );
}

/**
 * `date` shifted by `minutes` (negative allowed), as a JS Date.
 */
function addMinutes({date, minutes}) {
  return toLuxonUTC({date}).plus({minutes}).toJSDate();
}

/**
 * Human date-time in a zone, e.g. "21 Aug 2026 · 17:00 ET". Used in
 * notification copy where the recipient reads wall-clock time.
 */
function formatInZone({date, zone, format = "d MMM yyyy 'at' HH:mm ZZZZ"}) {
  const value = toLuxonUTC({date});

  return value && value.isValid ? value.setZone(zone).toFormat(format) : '';
}

module.exports = {
  getDayRangeInZone,
  getMinutesBetween,
  addMinutes,
  formatInZone,
  getCurrentDateTime,
  currentDate,
  formatDate,
  isValidDate,
  getCurrentTimeInSeconds,
  getCurrentYear,
  normalizeToISO,
  getToday,
  getCurrentTime,
  getDaysFromNow,
  toLuxonUTC,
  todayUTC,
  buildDateRangeClause,
  toDateOnlyUTC,
  getDaysBetween,
  parseFromFormats,
  getEpochMillis,
  getCurrentUTCISO,
  getUTCDaysAgoFormatted,
  addToFormattedUTC,
  nowInZone,
};
