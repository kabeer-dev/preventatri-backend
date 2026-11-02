/**
 * Value normalisers shared by every HHAeXchange record mapper.
 *
 * Extracted from patientMapper when the caregiver feed arrived: both feeds send
 * the same free-text phone numbers, the same zero-stripped ZIPs, the same mixed
 * date shapes and the same self-closing empty elements, so the handling belongs
 * in one place rather than being copied per resource.
 *
 * Pure functions only -- no I/O, no Prisma, no config reads.
 *
 * These are deliberately STRICTER than the Postgres columns. The sync path
 * never passes through the Yup schemas that guard the HTTP routes, so a raw
 * passthrough would write values that later fail validation on a field the
 * admin cannot even edit.
 */

const {normalizeToISO, parseFromFormats} = require('../dateUtils');

const {normalizePhoneNumber} = require('../phoneUtils');
const {normalizeValue} = require('./soapClient');

const {
  HHAX_FIELD_MAX_LENGTHS,
  HHAX_ZIP_LENGTH,
  HHAX_DATE_FORMATS,
} = require('../../constants/hhaExchangeConstants');

/** Trim, collapse empty to null, and cut to the column width. */
const toTrimmed = ({value, maxLength}) => {
  const normalized = normalizeValue({value});

  if (normalized === null) return null;

  return maxLength ? normalized.slice(0, maxLength) : normalized;
};

/**
 * HHAeXchange sends phone numbers as free text -- "(555) 123-4567 ext 12" is 24
 * characters and would fail an insert into a VarChar(20) column. Normalise with
 * the same rule the request schemas apply, then cut to the column width.
 */
const toPhone = ({value}) => {
  const normalized = normalizePhoneNumber({value: normalizeValue({value})});

  return normalized === null
    ? null
    : normalized.slice(0, HHAX_FIELD_MAX_LENGTHS.PHONE);
};

/**
 * Zip5 is a string in the change feeds but a nillable s:int elsewhere, where a
 * leading zero is lost -- "01234" arrives as 1234. Left-pad rather than trusting
 * whichever call supplied it.
 */
const toZipCode = ({value}) => {
  const normalized = normalizeValue({value});

  if (normalized === null) return null;

  const digits = normalized.replace(/\D/g, '');

  if (digits === '' || Number(digits) === 0) return null;

  return digits
    .padStart(HHAX_ZIP_LENGTH, '0')
    .slice(0, HHAX_FIELD_MAX_LENGTHS.ZIP_CODE);
};

/** Two-letter code, uppercased. Anything longer is not a code and is dropped. */
const toStateCode = ({value}) => {
  const normalized = normalizeValue({value});

  if (normalized === null) return null;

  const upper = normalized.toUpperCase();

  return upper.length === HHAX_FIELD_MAX_LENGTHS.STATE ? upper : null;
};

/**
 * HHAeXchange mixes date shapes inside a single payload, so each candidate
 * format is tried explicitly. A single permissive parse would read
 * "2025-06-28 00:00:00" in the runtime's local zone and shift the date, so the
 * formats are handed to parseFromFormats, which anchors them to UTC.
 *
 * The last three entries arrived with the visit feed (live-verified
 * 2026-09-01): LastModifiedDate and the deleted feed's dates carry
 * milliseconds, the schedule times drop the seconds, and ISO_LOCAL is the
 * zone-less shape the "0001-01-01T00:00:00" unset sentinel uses. They are
 * additive -- every shape the demographic feeds send still parses exactly as it
 * did, and each new one would otherwise silently store null.
 */
const toDate = ({value}) => {
  const parsed = parseFromFormats({
    value: normalizeValue({value}),
    formats: [
      HHAX_DATE_FORMATS.ISO_UTC,
      HHAX_DATE_FORMATS.ISO_UTC_NO_MS,
      HHAX_DATE_FORMATS.SQL_DATETIME,
      HHAX_DATE_FORMATS.DATE_ONLY,
      HHAX_DATE_FORMATS.SQL_DATETIME_MS,
      HHAX_DATE_FORMATS.SQL_DATETIME_NO_SECONDS,
      HHAX_DATE_FORMATS.ISO_LOCAL,
    ],
  });

  if (parsed === null) return null;

  // HHAeXchange uses 1900-01-01 as its "unset date" sentinel on the demographic
  // feeds and 0001-01-01T00:00:00 on the visit feed. One year guard covers both.
  return parsed.year <= 1900 ? null : parsed.toJSDate();
};

/** UTC ISO string for a Date, used when a mapped value has to be hashed. */
const toISOString = ({date}) => normalizeToISO({date});

module.exports = {
  toTrimmed,
  toPhone,
  toZipCode,
  toStateCode,
  toDate,
  toISOString,
};
