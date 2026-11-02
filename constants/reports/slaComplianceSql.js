const {patientRegionColumn, patientScope} = require('./reportSqlFragments');

const {
  ESCALATION_ACTIONS,
  ESCALATION_STATUSES,
} = require('../escalationConstants');

const {Prisma} = require('../../generated/prisma/client');

// The dashboard SLA rule, the one SLA definition: resolved in the window
// (updated_at), within SLA when the escalation was never escalated.
const SLA_ESCALATIONS_CTE = ({organizationId, startISO, endISO, scope}) =>
  Prisma.sql`
  sla_escalations AS (
    SELECT
      e."patientId" AS patient_id,
      e."updated_at" AS resolved_at,
      NOT EXISTS (
        SELECT 1 FROM submission_flag_escalation_events ev
        WHERE ev."escalation_id" = e."id"
          AND ev."action" = ${ESCALATION_ACTIONS.ESCALATED.value}
      ) AS is_within_sla
    FROM submission_flag_escalations e
    WHERE e."organizationId" = ${organizationId}
      AND e."status" = ${ESCALATION_STATUSES.RESOLVED.value}
      AND e."updated_at" >= ${startISO}::timestamptz
      AND e."updated_at" <  ${endISO}::timestamptz
      ${patientScope({patientIdColumn: 'e."patientId"', scope})}
  )
`;

const SLA_COUNTS = Prisma.sql`
  COUNT(*)::int AS resolved_total,
  COUNT(*) FILTER (WHERE is_within_sla)::int AS within_sla
`;

const SLA_COMPLIANCE_BY_DAY_SQL = ({
  organizationId,
  startISO,
  endISO,
  timeZone,
  scope,
}) => Prisma.sql`
  WITH ${SLA_ESCALATIONS_CTE({organizationId, startISO, endISO, scope})}
  SELECT
    to_char(date_trunc('day', resolved_at AT TIME ZONE ${timeZone}::text), 'YYYY-MM-DD') AS day,
    ${SLA_COUNTS}
  FROM sla_escalations
  GROUP BY 1
`;

const SLA_COMPLIANCE_TOTAL_SQL = ({organizationId, period, scope}) =>
  Prisma.sql`
  WITH ${SLA_ESCALATIONS_CTE({
    organizationId,
    startISO: period.startISO,
    endISO: period.endISO,
    scope,
  })}
  SELECT ${SLA_COUNTS} FROM sla_escalations
`;

// NULL region_id is the "Unassigned region" row.
const SLA_COMPLIANCE_BY_REGION_SQL = ({organizationId, period, scope}) =>
  Prisma.sql`
  WITH ${SLA_ESCALATIONS_CTE({
    organizationId,
    startISO: period.startISO,
    endISO: period.endISO,
    scope,
  })}
  SELECT
    ${patientRegionColumn({patientIdColumn: 'patient_id'})} AS region_id,
    ${SLA_COUNTS}
  FROM sla_escalations
  GROUP BY 1
`;

module.exports = {
  SLA_COMPLIANCE_BY_DAY_SQL,
  SLA_COMPLIANCE_BY_REGION_SQL,
  SLA_COMPLIANCE_TOTAL_SQL,
};
