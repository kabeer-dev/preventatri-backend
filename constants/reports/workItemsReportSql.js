const {
  bucketLabel,
  inWindow,
  patientRegionColumn,
  patientScope,
  utcInstant,
} = require('./reportSqlFragments');

const {
  FOLLOW_UP_TASK_EVENT_TYPES,
  FOLLOW_UP_TASK_STATUSES,
} = require('../followUpTasksConstants');

const {
  SUPERVISORY_VISIT_COMPLETION_OUTCOMES,
  SUPERVISORY_VISIT_EVENT_TYPES,
  SUPERVISORY_VISIT_STATUSES,
} = require('../supervisoryVisitsConstants');
const {SYSTEM_ROLES} = require('../usersConstants');

const {Prisma} = require('../../generated/prisma/client');

const TASK_COMPLETED = FOLLOW_UP_TASK_STATUSES.completed.value;
const TASK_OVERDUE = FOLLOW_UP_TASK_STATUSES.overdue.value;
const VISIT_OVERDUE = SUPERVISORY_VISIT_STATUSES.overdue.value;

// Live, whatever the period. Region still applies.
const OVERDUE_NOW_BY_REGION_SQL = ({organizationId, scope}) => Prisma.sql`
  SELECT region_id, kind, COUNT(*)::int AS count
  FROM (
    SELECT ${patientRegionColumn({patientIdColumn: 'items.patient_id'})} AS region_id, items.kind
    FROM (
      SELECT 'task' AS kind, t."patient_id" AS patient_id FROM follow_up_tasks t
      WHERE t."organization_id" = ${organizationId} AND t."deleted_at" IS NULL AND t."status" = ${TASK_OVERDUE}::text
      UNION ALL
      SELECT 'visit' AS kind, v."patient_id" AS patient_id FROM supervisory_visits v
      WHERE v."organization_id" = ${organizationId} AND v."deleted_at" IS NULL AND v."status" = ${VISIT_OVERDUE}::text
    ) items
    WHERE TRUE
      ${patientScope({patientIdColumn: 'items.patient_id', scope})}
  ) placed
  GROUP BY 1, 2
`;

// Case manager tasks created in the period: on time out of completed or overdue.
// Overdue tasks move to the admin, so the owner comes from ESCALATED_TO_ADMIN.
const CASE_MANAGER_TASKS_SQL = ({organizationId, period, scope}) => Prisma.sql`
  SELECT
    COUNT(*) FILTER (
      WHERE t."status" = ${TASK_COMPLETED}::text AND (t."completed_at" AT TIME ZONE 'UTC') <= t."due_at"
    )::int AS on_time,
    COUNT(*) FILTER (WHERE t."status" IN (${TASK_COMPLETED}::text, ${TASK_OVERDUE}::text))::int AS closed_or_overdue,
    COUNT(DISTINCT uo."id")::int AS people
  FROM follow_up_tasks t
  LEFT JOIN LATERAL (
    SELECT e."from_assignee_user_organization_id" AS owner_id
    FROM follow_up_task_events e
    WHERE e."task_id" = t."id"::uuid
      AND e."type" = ${FOLLOW_UP_TASK_EVENT_TYPES.escalatedToAdmin.value}::text
    ORDER BY e."created_at" ASC
    LIMIT 1
  ) escalation ON TRUE
  JOIN user_organizations uo
    ON uo."id" = COALESCE(escalation.owner_id, t."assignee_user_organization_id")
  WHERE t."organization_id" = ${organizationId}
    AND t."deleted_at" IS NULL
    AND uo."role"::text = ${SYSTEM_ROLES.case_manager.value}::text
    AND ${inWindow({instant: utcInstant({column: 't."created_at"'}), window: period})}
    ${patientScope({patientIdColumn: 't."patient_id"', scope})}
`;

const TASKS_CTE = ({organizationId, period, scope}) => Prisma.sql`
  tasks AS (
    SELECT t."status", t."due_at", t."created_at", t."completed_at"
    FROM follow_up_tasks t
    WHERE t."organization_id" = ${organizationId}
      AND t."deleted_at" IS NULL
      AND ${inWindow({instant: utcInstant({column: 't."created_at"'}), window: period})}
      ${patientScope({patientIdColumn: 't."patient_id"', scope})}
  )
`;

const TASK_KPIS_SQL = ({organizationId, period, scope}) => Prisma.sql`
  WITH ${TASKS_CTE({organizationId, period, scope})}
  SELECT
    COUNT(*)::int AS created,
    COUNT(*) FILTER (WHERE "status" = ${TASK_COMPLETED}::text)::int AS completed,
    COUNT(*) FILTER (
      WHERE "status" = ${TASK_COMPLETED}::text AND ("completed_at" AT TIME ZONE 'UTC') <= "due_at"
    )::int AS completed_on_time,
    COUNT(*) FILTER (WHERE "status" = ${TASK_OVERDUE}::text)::int AS overdue_in_period
  FROM tasks
`;

const TASKS_CREATED_BY_BUCKET_SQL = ({
  organizationId,
  period,
  scope,
}) => Prisma.sql`
  WITH ${TASKS_CTE({organizationId, period, scope})}
  SELECT
    ${bucketLabel({instant: utcInstant({column: '"created_at"'}), window: period})} AS bucket,
    COUNT(*)::int AS count
  FROM tasks
  GROUP BY 1
`;

// Completed in the bucket, whenever the task was created.
const TASKS_COMPLETED_BY_BUCKET_SQL = ({
  organizationId,
  period,
  scope,
}) => Prisma.sql`
  SELECT
    ${bucketLabel({instant: utcInstant({column: 't."completed_at"'}), window: period})} AS bucket,
    COUNT(*)::int AS count
  FROM follow_up_tasks t
  WHERE t."organization_id" = ${organizationId}
    AND t."deleted_at" IS NULL
    AND t."status" = ${TASK_COMPLETED}::text
    AND ${inWindow({instant: utcInstant({column: 't."completed_at"'}), window: period})}
    ${patientScope({patientIdColumn: 't."patient_id"', scope})}
  GROUP BY 1
`;

const VISITS_CTE = ({organizationId, period, scope}) => Prisma.sql`
  visits AS (
    SELECT
      v."id", v."status", v."scheduled_end_at", v."completed_at",
      v."completion_outcome", v."reviewed_at", v."completed_by", v."reviewed_by"
    FROM supervisory_visits v
    WHERE v."organization_id" = ${organizationId}
      AND v."deleted_at" IS NULL
      AND ${inWindow({instant: Prisma.sql`v."scheduled_start_at"`, window: period})}
      ${patientScope({patientIdColumn: 'v."patient_id"', scope})}
  )
`;

// visit_id is uuid; the cast keeps the match whatever type visits.id has.
const VISIT_KPIS_SQL = ({organizationId, period, scope}) => Prisma.sql`
  WITH ${VISITS_CTE({organizationId, period, scope})}
  SELECT
    COUNT(*)::int AS scheduled,
    COUNT(*) FILTER (WHERE "completed_at" IS NOT NULL)::int AS filed,
    COUNT(*) FILTER (
      WHERE "completed_at" IS NOT NULL
        AND ("completed_at" AT TIME ZONE 'UTC') <= "scheduled_end_at"
    )::int AS filed_on_time,
    COUNT(*) FILTER (WHERE "status" = ${VISIT_OVERDUE}::text)::int AS overdue_in_period,
    COUNT(*) FILTER (
      WHERE "completion_outcome" = ${SUPERVISORY_VISIT_COMPLETION_OUTCOMES.concernsNoted.value}::text
    )::int AS concerns_noted,
    -- Self-approved on filing (filer is the reviewer) has no real review time.
    percentile_cont(0.5) WITHIN GROUP (
      ORDER BY EXTRACT(EPOCH FROM ("reviewed_at" - ("completed_at" AT TIME ZONE 'UTC')))
    ) FILTER (
      WHERE "reviewed_at" IS NOT NULL
        AND "completed_at" IS NOT NULL
        AND "reviewed_by" IS DISTINCT FROM "completed_by"
    ) AS median_review_seconds,
    (
      SELECT COUNT(*)::int
      FROM supervisory_visit_events e
      WHERE e."organization_id" = ${organizationId}
        AND e."type" = ${SUPERVISORY_VISIT_EVENT_TYPES.correctionRequested.value}::text
        AND e."visit_id" IN (SELECT "id"::uuid FROM visits)
    ) AS correction_requested
  FROM visits
`;

const VISIT_STATUS_MIX_SQL = ({organizationId, period, scope}) => Prisma.sql`
  WITH ${VISITS_CTE({organizationId, period, scope})}
  SELECT "status" AS status, COUNT(*)::int AS count
  FROM visits
  GROUP BY 1
`;

module.exports = {
  OVERDUE_NOW_BY_REGION_SQL,
  CASE_MANAGER_TASKS_SQL,
  TASK_KPIS_SQL,
  TASKS_CREATED_BY_BUCKET_SQL,
  TASKS_COMPLETED_BY_BUCKET_SQL,
  VISIT_KPIS_SQL,
  VISIT_STATUS_MIX_SQL,
};
