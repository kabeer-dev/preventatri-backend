const {ESCALATION_STATUSES} = require('./escalationConstants');

const {Prisma} = require('../generated/prisma/client');

// Raised-to-resolved time, averaged over the flags resolved since `since`.
// NULL when none were resolved, so the card shows no data instead of 0.
const AVERAGE_RESOLUTION_MINUTES_SQL = ({organizationId, since}) => Prisma.sql`
  SELECT
    (AVG(EXTRACT(EPOCH FROM (r."created_at" - e."created_at"))) / 60)::float8 AS avg_minutes
  FROM submission_flag_escalations e
  JOIN submission_flag_escalation_responses r ON r."escalation_id" = e."id"
  WHERE e."organizationId" = ${organizationId}
    AND e."status"::text = ${ESCALATION_STATUSES.RESOLVED.value}::text
    AND r."created_at" >= ${since}
`;

module.exports = {AVERAGE_RESOLUTION_MINUTES_SQL};
