const {DateTime} = require('luxon');

const {
  REPORT_DEFAULT_WINDOW_DAYS,
  REPORT_GRAIN_LIMITS,
  REPORT_GRAINS,
} = require('../constants/reportsConstants');

const DATE_FORMAT = 'yyyy-MM-dd';

function resolveGrain({spanDays}) {
  if (spanDays <= REPORT_GRAIN_LIMITS.DAY_MAX_SPAN) return REPORT_GRAINS.DAY;

  if (spanDays <= REPORT_GRAIN_LIMITS.WEEK_MAX_SPAN) return REPORT_GRAINS.WEEK;

  return REPORT_GRAINS.MONTH;
}

function parseLocalDay({value, timeZone}) {
  if (!value) return null;

  const day = DateTime.fromISO(value, {zone: timeZone}).startOf('day');

  return day.isValid ? day : null;
}

// Luxon's startOf('week') is ISO Monday, the same as Postgres date_trunc('week').
function buildBuckets({fromDay, toDay, grain}) {
  const lastInstant = toDay.endOf('day');
  const buckets = [];

  for (
    let cursor = fromDay.startOf(grain);
    cursor <= toDay;
    cursor = cursor.plus({[grain]: 1})
  ) {
    buckets.push({
      key: cursor.toFormat(DATE_FORMAT),
      partial: cursor < fromDay || cursor.endOf(grain) > lastInstant,
    });
  }

  return buckets;
}

function describePeriod({fromDay, toDay}) {
  return {
    from: fromDay.toFormat(DATE_FORMAT),
    to: toDay.toFormat(DATE_FORMAT),
    startISO: fromDay.toISO(),
    endISO: toDay.plus({days: 1}).toISO(),
  };
}

function buildReportWindow({from, to, timeZone, now = DateTime.now()}) {
  const today = now.setZone(timeZone).startOf('day');
  const toDay = parseLocalDay({value: to, timeZone}) || today;

  const fromDay =
    parseLocalDay({value: from, timeZone}) ||
    toDay.minus({days: REPORT_DEFAULT_WINDOW_DAYS - 1});

  // Math.round absorbs the 23 or 25 hour day at a DST change.
  const spanDays = Math.round(toDay.diff(fromDay, 'days').days) + 1;
  const grain = resolveGrain({spanDays});

  const previousToDay = fromDay.minus({days: 1});
  const previousFromDay = previousToDay.minus({days: spanDays - 1});

  const current = describePeriod({fromDay, toDay});

  return {
    timeZone,
    grain,
    spanDays,
    from: current.from,
    to: current.to,
    startISO: current.startISO,
    endISO: current.endISO,
    today: today.toFormat(DATE_FORMAT),
    buckets: buildBuckets({fromDay, toDay, grain}),
    previous: Object.assign(
      {timeZone, grain},
      describePeriod({fromDay: previousFromDay, toDay: previousToDay})
    ),
  };
}

function buildDayLabels({window}) {
  const labels = [];
  const toDay = DateTime.fromISO(window.to, {zone: window.timeZone});

  for (
    let cursor = DateTime.fromISO(window.from, {zone: window.timeZone});
    cursor <= toDay;
    cursor = cursor.plus({days: 1})
  ) {
    labels.push(cursor.toFormat(DATE_FORMAT));
  }

  return labels;
}

function toPeriodWindow({window, period}) {
  if (period === 'previous') return window.previous;

  return {
    timeZone: window.timeZone,
    grain: window.grain,
    from: window.from,
    to: window.to,
    startISO: window.startISO,
    endISO: window.endISO,
  };
}

module.exports = {
  buildDayLabels,
  buildReportWindow,
  resolveGrain,
  toPeriodWindow,
};
