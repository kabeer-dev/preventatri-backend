const {patientScope} = require('./reportSqlFragments');

const {PATIENT_STATUSES} = require('../patientsConstants');

const {Prisma} = require('../../generated/prisma/client');

// Inactive or deleted regions get a row only while they hold records, so the
// scorecard adds up to the KPI tiles.
const REGIONS_IN_SCOPE_SQL = ({organizationId, regionId}) => Prisma.sql`
  SELECT
    r."id" AS region_id,
    r."name" AS region_name,
    (r."deleted_at" IS NULL AND r."isActive" = TRUE) AS is_listed
  FROM regions r
  WHERE r."organizationId" = ${organizationId}
    ${regionId ? Prisma.sql`AND r."id" = ${regionId}` : Prisma.empty}
  ORDER BY r."name"
`;

// Live. A NULL region_id row counts active patients with no county.
const ACTIVE_PATIENTS_BY_REGION_SQL = ({organizationId, scope}) => Prisma.sql`
  SELECT c."regionId" AS region_id, COUNT(*)::int AS active_patients
  FROM patients p
  LEFT JOIN counties c ON c."id" = p."countyId"
  WHERE p."organizationId" = ${organizationId}
    AND p."deleted_at" IS NULL
    AND p."status"::text = ${PATIENT_STATUSES.ACTIVE.value}::text
    ${patientScope({patientIdColumn: 'p."id"', scope})}
  GROUP BY 1
`;

module.exports = {REGIONS_IN_SCOPE_SQL, ACTIVE_PATIENTS_BY_REGION_SQL};
