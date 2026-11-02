const {patientRegionColumn, patientScope} = require('./reportSqlFragments');

const {
  CHECKLIST_SUBMISSION_STATUSES: STATUS,
} = require('../assessmentConstants');
const {REPORT_ASSESSMENT_OUTCOMES: OUTCOME} = require('../reportsConstants');

const {Prisma} = require('../../generated/prisma/client');

const EXCLUDED_STATUSES = [STATUS.VOIDED.value, STATUS.UPCOMING.value];

const PEOPLE_OUTCOMES = [
  OUTCOME.ON_TIME,
  STATUS.LATE.value,
  STATUS.MISSED.value,
];

// due_date is the UTC start of the due day; submittedAt is UTC wall clock.
// SKIPPED and MISSED are checked first so a stray submittedAt cannot move them.
const SUBMISSIONS_CTE = ({organizationId, period, scope}) => Prisma.sql`
  due AS (
    SELECT
      s."id",
      s."patientId" AS patient_id,
      s."assigneeId" AS assignee_id,
      CASE
        WHEN s."status"::text = ${STATUS.SKIPPED.value}::text THEN ${STATUS.SKIPPED.value}::text
        WHEN s."status"::text = ${STATUS.MISSED.value}::text THEN ${STATUS.MISSED.value}::text
        WHEN s."submittedAt" IS NOT NULL
          AND ((s."submittedAt" AT TIME ZONE 'UTC') AT TIME ZONE ${period.timeZone}::text)::date <= s."due_date"::date
          THEN ${OUTCOME.ON_TIME}::text
        WHEN s."submittedAt" IS NOT NULL THEN ${STATUS.LATE.value}::text
        ELSE ${OUTCOME.OPEN}::text
      END AS outcome
    FROM checklist_submissions s
    WHERE s."organizationId" = ${organizationId}
      AND s."deleted_at" IS NULL
      AND s."status"::text NOT IN (${Prisma.join(EXCLUDED_STATUSES)})
      AND s."due_date"::date >= ${period.from}::date
      AND s."due_date"::date <= ${period.to}::date
      ${patientScope({patientIdColumn: 's."patientId"', scope})}
  )
`;

const OUTCOME_COUNTS = Prisma.sql`
  COUNT(*)::int AS due,
  COUNT(*) FILTER (WHERE outcome = ${OUTCOME.ON_TIME}::text)::int AS on_time,
  COUNT(*) FILTER (WHERE outcome = ${STATUS.LATE.value}::text)::int AS late,
  COUNT(*) FILTER (WHERE outcome = ${STATUS.MISSED.value}::text)::int AS missed,
  COUNT(DISTINCT assignee_id) FILTER (WHERE outcome IN (${Prisma.join(PEOPLE_OUTCOMES)}))::int AS people
`;

const ASSESSMENT_KPIS_SQL = ({organizationId, period, scope}) => Prisma.sql`
  WITH ${SUBMISSIONS_CTE({organizationId, period, scope})}
  SELECT ${OUTCOME_COUNTS} FROM due
`;

const ASSESSMENTS_BY_REGION_SQL = ({
  organizationId,
  period,
  scope,
}) => Prisma.sql`
  WITH ${SUBMISSIONS_CTE({organizationId, period, scope})},
  placed AS (
    SELECT due.*, ${patientRegionColumn({patientIdColumn: 'due.patient_id'})} AS region_id
    FROM due
  )
  SELECT region_id, ${OUTCOME_COUNTS}
  FROM placed
  GROUP BY 1
`;

module.exports = {
  SUBMISSIONS_CTE,
  ASSESSMENT_KPIS_SQL,
  ASSESSMENTS_BY_REGION_SQL,
};
