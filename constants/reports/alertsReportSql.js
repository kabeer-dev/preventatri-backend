const {
  inWindow,
  patientRegionColumn,
  patientScope,
  utcInstant,
} = require('./reportSqlFragments');

const {
  ESCALATION_ACTIONS,
  ESCALATION_LEVELS,
} = require('../escalationConstants');

const {
  REPORT_ALERT_FLAGS,
  REPORT_NURSE_LEVELS,
  REPORT_TIMEOUT_ACTIONS,
} = require('../reportsConstants');
const {RISK_SCORE_THRESHOLDS} = require('../riskCalcConstants');
const {SUBMISSION_FLAG_STATUS} = require('../submissionFlagConstants');

const {Prisma} = require('../../generated/prisma/client');

// Red and yellow flags raised in the period (voided included), each followed
// to its outcome.
const ALERTS_CTE = ({organizationId, period, scope}) => Prisma.sql`
  alerts AS (
    SELECT
      f."id" AS flag_id,
      f."flag"::text AS flag,
      f."status"::text AS status,
      f."patientId" AS patient_id,
      ${patientRegionColumn({patientIdColumn: 'f."patientId"'})} AS region_id,
      e."id" AS escalation_id,
      e."created_at" AS escalated_at,
      e."acknowledged_at" AS accepted_at,
      r."created_at" AS resolved_at
    FROM submission_flags f
    LEFT JOIN submission_flag_escalations e ON e."submission_flag_id" = f."id"
    LEFT JOIN submission_flag_escalation_responses r ON r."escalation_id" = e."id"
    WHERE f."organizationId" = ${organizationId}
      AND f."deleted_at" IS NULL
      AND f."flag"::text IN (${Prisma.join(REPORT_ALERT_FLAGS)})
      AND ${inWindow({instant: utcInstant({column: 'f."createdAt"'}), window: period})}
      ${patientScope({patientIdColumn: 'f."patientId"', scope})}
  ),
  classified AS (
    SELECT
      a.*,
      EXTRACT(EPOCH FROM (a.resolved_at - a.escalated_at))::float8 AS resolve_seconds,
      EXTRACT(EPOCH FROM (a.accepted_at - a.escalated_at))::float8 AS accept_seconds
    FROM alerts a
  )
`;

const ALERT_METRICS = Prisma.sql`
  COUNT(*)::int AS raised,
  COUNT(*) FILTER (WHERE flag = ${RISK_SCORE_THRESHOLDS.RED.flag}::text)::int AS raised_red,
  COUNT(*) FILTER (WHERE flag = ${RISK_SCORE_THRESHOLDS.YELLOW.flag}::text)::int AS raised_yellow,
  COUNT(*) FILTER (WHERE status = ${SUBMISSION_FLAG_STATUS.ACCEPTED}::text)::int AS accepted,
  COUNT(*) FILTER (WHERE status = ${SUBMISSION_FLAG_STATUS.RESOLVED}::text)::int AS resolved,
  COUNT(*) FILTER (WHERE status = ${SUBMISSION_FLAG_STATUS.VOIDED}::text)::int AS voided,
  percentile_cont(0.5) WITHIN GROUP (ORDER BY resolve_seconds)
    FILTER (WHERE resolve_seconds IS NOT NULL AND status <> ${SUBMISSION_FLAG_STATUS.VOIDED}::text) AS median_resolve_seconds,
  percentile_cont(0.9) WITHIN GROUP (ORDER BY resolve_seconds)
    FILTER (WHERE resolve_seconds IS NOT NULL AND status <> ${SUBMISSION_FLAG_STATUS.VOIDED}::text) AS p90_resolve_seconds,
  percentile_cont(0.5) WITHIN GROUP (ORDER BY accept_seconds)
    FILTER (WHERE accept_seconds IS NOT NULL AND status <> ${SUBMISSION_FLAG_STATUS.VOIDED}::text) AS median_accept_seconds
`;

const ALERT_KPIS_SQL = ({organizationId, period, scope}) => Prisma.sql`
  WITH ${ALERTS_CTE({organizationId, period, scope})}
  SELECT ${ALERT_METRICS} FROM classified
`;

// NULL region_id is the "Unassigned region" row.
const ALERTS_BY_REGION_SQL = ({organizationId, period, scope}) => Prisma.sql`
  WITH ${ALERTS_CTE({organizationId, period, scope})}
  SELECT region_id, ${ALERT_METRICS}
  FROM classified
  GROUP BY 1
`;

// Nurse-level pages resolved before their timer, out of pages that ended.
const NURSE_PAGES_SQL = ({organizationId, period, scope}) => Prisma.sql`
  WITH ${ALERTS_CTE({organizationId, period, scope})}
  SELECT
    COUNT(*) FILTER (WHERE ev."action"::text = ${ESCALATION_ACTIONS.RESOLVED.value}::text)::int AS resolved,
    COUNT(*) FILTER (
      WHERE ev."action"::text = ${ESCALATION_ACTIONS.RESOLVED.value}::text
        OR ev."action"::text IN (${Prisma.join(REPORT_TIMEOUT_ACTIONS)})
    )::int AS closed,
    COUNT(DISTINCT ev."assigneeId")::int AS people
  FROM classified c
  JOIN submission_flag_escalation_events ev ON ev."escalation_id" = c.escalation_id
  WHERE c.status <> ${SUBMISSION_FLAG_STATUS.VOIDED}::text
    AND ev."level"::text IN (${Prisma.join(REPORT_NURSE_LEVELS)})
`;

// Alerts that reached the admin step, and how many admins resolved.
const ADMIN_PAGES_SQL = ({organizationId, period, scope}) => Prisma.sql`
  WITH ${ALERTS_CTE({organizationId, period, scope})}
  SELECT
    COUNT(DISTINCT c.flag_id) FILTER (
      WHERE ev."action"::text = ${ESCALATION_ACTIONS.RESOLVED.value}::text
    )::int AS resolved,
    COUNT(DISTINCT c.flag_id)::int AS reached,
    COUNT(DISTINCT ev."assigneeId") FILTER (
      WHERE ev."action"::text = ${ESCALATION_ACTIONS.RESOLVED.value}::text
    )::int AS people
  FROM classified c
  JOIN submission_flag_escalation_events ev ON ev."escalation_id" = c.escalation_id
  WHERE c.status <> ${SUBMISSION_FLAG_STATUS.VOIDED}::text
    AND ev."level"::text = ${ESCALATION_LEVELS.ADMIN.value}::text
`;

module.exports = {
  ADMIN_PAGES_SQL,
  ALERTS_CTE,
  ALERT_KPIS_SQL,
  ALERTS_BY_REGION_SQL,
  NURSE_PAGES_SQL,
};
