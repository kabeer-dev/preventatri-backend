const {getToday, toLuxonUTC} = require('./dateUtils');

const {
  CHECKLIST_SUBMISSION_STATUSES,
  LATENESS_TRACKED_STATUSES,
} = require('../constants/assessmentConstants');

const {
  CHECKLIST_ASSIGNMENT_TYPES,
  DUE_DATE_OFFSET_DAYS,
} = require('../constants/checklistAssignmentConstants');

/**
 * Computes all submission periods for an assignment based on its type.
 *
 * DAILY:   1-day periods
 * WEEKLY:  7-day periods
 * MONTHLY: calendar-month periods
 *
 * Each period includes:
 *   - periodStart: start of the period
 *   - dueDate:     start of the period (when the checklist is due)
 *   - deadline:    dueDate + DUE_DATE_OFFSET_DAYS[type] (grace period hard cutoff)
 *
 * @returns {Array<{periodIndex, periodStart, deadline, dueDate}>}
 */
function computePeriods({startDate, endDate, type}) {
  const start = toLuxonUTC({date: startDate});
  const end = toLuxonUTC({date: endDate});

  if (!start || !end || end < start) return [];

  const offsetDays =
    DUE_DATE_OFFSET_DAYS[type] !== undefined ? DUE_DATE_OFFSET_DAYS[type] : 2;

  const periods = [];
  let periodIndex = 0;
  let periodStart = start.startOf('day');

  while (periodStart <= end) {
    let nextPeriodStart;

    if (type === CHECKLIST_ASSIGNMENT_TYPES.DAILY.value) {
      nextPeriodStart = periodStart.plus({days: 1}).startOf('day');
    } else if (type === CHECKLIST_ASSIGNMENT_TYPES.WEEKLY.value) {
      nextPeriodStart = periodStart.plus({days: 7}).startOf('day');
    } else if (type === CHECKLIST_ASSIGNMENT_TYPES.MONTHLY.value) {
      nextPeriodStart = start.plus({months: periodIndex + 1}).startOf('day');
    } else {
      break;
    }

    // dueDate is the first day of the period (date-only, midnight UTC)
    const dueDate = periodStart;

    // deadline is offsetDays after dueDate (grace period hard cutoff, date-only)
    const deadline = dueDate.plus({days: offsetDays}).startOf('day');

    periods.push({periodIndex, periodStart, deadline, dueDate});

    periodIndex++;
    periodStart = nextPeriodStart;
  }

  return periods;
}

/**
 * Builds the Prisma where-fragment that matches checklist assignments a caregiver
 * is currently allowed to act on: the assignment has started, is not soft-deleted,
 * and is still inside its grace window (endDate + DUE_DATE_OFFSET_DAYS[type]) so
 * LATE submissions from the final periods stay reachable.
 *
 * Two supported usages:
 *   - inside a `some` clause on a patient query, alongside the caller's caregiver
 *     predicate. This also gives multi-assignment semantics for free: the patient
 *     stays reachable while at least one assignment is live.
 *   - merged into a query on ChecklistAssignment itself (see
 *     PatientsServices.getAssignment).
 *
 * The only constraint is the returned `OR` key — never merge this into an object
 * that already carries its own `OR`, or one of the two will silently overwrite
 * the other.
 *
 * `today` accepts anything toLuxonUTC handles (JS Date, ISO string, Luxon
 * DateTime) and is normalized once, so both bounds always compare against the
 * same instant as a JS Date.
 *
 * @returns {{isDeleted: null, startDate: object, OR: Array<object>}}
 */
function buildLiveAssignmentClause({today = getToday()} = {}) {
  const todayUTC = toLuxonUTC({date: today});
  const todayDate = todayUTC.toJSDate();

  const graceWindows = Object.keys(DUE_DATE_OFFSET_DAYS).map((type) => ({
    type,
    endDate: {
      gte: todayUTC.minus({days: DUE_DATE_OFFSET_DAYS[type]}).toJSDate(),
    },
  }));

  return {isDeleted: null, startDate: {lte: todayDate}, OR: graceWindows};
}

// Patient where-fragment: the caregiver still has a live assignment to the
// patient, the same bar the patient page uses.
function buildCaregiverPatientAccessClause({userId}) {
  return {
    checklistAssignments: {
      some: Object.assign(
        {caregiverProfile: {userId}},
        buildLiveAssignmentClause()
      ),
    },
  };
}

/**
 * Whole UTC days a submission is (or was sent) past its due date, or null when
 * it is on time or its status carries no lateness. UTC days match the cron's
 * status rule and the reports' on-time check.
 */
function getSubmissionLateDays({status, dueDate, submittedAt}) {
  if (!LATENESS_TRACKED_STATUSES.includes(status) || !dueDate) return null;

  const dueDay = toLuxonUTC({date: dueDate}).startOf('day');
  const endDay = toLuxonUTC({date: submittedAt || getToday()}).startOf('day');
  const lateDays = Math.floor(endDay.diff(dueDay, 'days').days);

  return lateDays > 0 ? lateDays : null;
}

// Submission where-fragment: the caregiver's own, plus any finished one, so a
// newly assigned caregiver sees the patient's history but not another's open work.
function buildCaregiverSubmissionVisibilityClause({userId}) {
  return {
    OR: [
      {assigneeId: userId},
      {status: CHECKLIST_SUBMISSION_STATUSES.SUBMITTED.value},
    ],
  };
}

module.exports = {
  buildLiveAssignmentClause,
  getSubmissionLateDays,
  buildCaregiverPatientAccessClause,
  buildCaregiverSubmissionVisibilityClause,
  computePeriods,
};
