/**
 * Common Yup validation schemas for organizations
 * Reusable validation patterns to avoid repetition across different validation functions
 */

const Yup = require('yup');

const {
  TIME_ZONE_KEYS,
  WEEKDAY_KEYS,
} = require('../constants/organizationsConstants');

const TIME_OF_DAY_REGEX = /^([01]\d|2[0-3]):([0-5]\d)$/;

/**
 * A single day's working-hours window: {enabled, startTime, endTime}.
 * All three fields are required once a day key is included in the request —
 * days are updated as a whole window, not field-by-field.
 * Used in: validateUpdateWorkingHoursRequest
 */
module.exports.workingHoursDaySchema = () =>
  Yup.object().shape({
    enabled: Yup.boolean().required('enabled is required'),
    startTime: Yup.string()
      .matches(TIME_OF_DAY_REGEX, 'startTime must be in HH:mm format')
      .required('startTime is required'),
    endTime: Yup.string()
      .matches(TIME_OF_DAY_REGEX, 'endTime must be in HH:mm format')
      .required('endTime is required')
      .test(
        'end-after-start',
        'endTime must be after startTime',
        function endAfterStart(endTime) {
          const {startTime} = this.parent;

          if (!startTime || !endTime) return true;

          return endTime > startTime;
        }
      ),
  });

/**
 * Weekly working-hours object — any subset of the 7 day keys, each a full
 * day window. Updating is per-day-replace: omitted days are left untouched.
 * Used in: validateUpdateWorkingHoursRequest
 */
module.exports.workingHoursSchema = () => {
  const dayShape = {};

  for (const day of WEEKDAY_KEYS) {
    dayShape[day] = module.exports.workingHoursDaySchema();
  }

  return Yup.object()
    .shape(dayShape)
    .test(
      'at-least-one-day',
      'At least one day must be provided',
      (value) =>
        value && Object.keys(value).some((day) => value[day] !== undefined)
    );
};

/**
 * The organization's selected time zone — one of the 6 supported USA time
 * zones (see AVAILABLE_TIME_ZONES in organizationsConstants).
 * Used in: the register (signup) request
 */
module.exports.timeZoneSchema = () =>
  Yup.string()
    .oneOf(
      TIME_ZONE_KEYS,
      `timeZone must be one of: ${TIME_ZONE_KEYS.join(', ')}`
    )
    .required('timeZone is required');
