const {nowInZone} = require('./dateUtils');
const {TIME_ZONES} = require('../constants/generalConstant');

const {
  WEEKDAY_KEYS,
  AVAILABLE_TIME_ZONES,
} = require('../constants/organizationsConstants');

/**
 * Whether the current time, in the organization's configured time zone,
 * falls inside its working hours for today. `workingHours` is the
 * Organization.workingHours JSON shape:
 * {monday: {enabled, startTime: 'HH:MM', endTime: 'HH:MM'}, ...}.
 * `timeZone` is the Organization.timeZone enum key (e.g. 'EASTERN'); it's
 * resolved to its IANA identifier via AVAILABLE_TIME_ZONES, falling back to
 * UTC if missing/unrecognized.
 *
 * Compares "HH:mm" strings lexicographically, which is safe since both the
 * current time and the stored bounds are zero-padded 24h times.
 */
function isWithinOrganizationWorkingHours({workingHours, timeZone}) {
  if (!workingHours) return false;

  const zone =
    AVAILABLE_TIME_ZONES[timeZone?.toLowerCase()]?.value ||
    TIME_ZONES.utc.value;
  const now = nowInZone({zone});
  const today = workingHours[WEEKDAY_KEYS[now.weekday - 1]];

  if (!today || !today.enabled) return false;

  const currentTime = now.toFormat('HH:mm');

  return currentTime >= today.startTime && currentTime <= today.endTime;
}

module.exports = {
  isWithinOrganizationWorkingHours,
};
