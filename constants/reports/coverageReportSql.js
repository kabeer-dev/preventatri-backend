const {patientRegionScope} = require('./reportSqlFragments');

const {ENTITY_STATUSES} = require('../generalConstant');
const {NURSE_REGION_ROLES} = require('../nursesConstants');
const {PATIENT_STATUSES} = require('../patientsConstants');

const {Prisma} = require('../../generated/prisma/client');

const activePatientsCount = ({
  organizationId,
  regionId,
  condition,
}) => Prisma.sql`
  SELECT COUNT(*)::int AS total
  FROM patients p
  WHERE p."organizationId" = ${organizationId}
    AND p."deleted_at" IS NULL
    AND p."status"::text = ${PATIENT_STATUSES.ACTIVE.value}::text
    AND ${condition}
    ${patientRegionScope({patientIdColumn: 'p."id"', regionId})}
`;

const PATIENTS_WITHOUT_COUNTY_SQL = ({organizationId}) =>
  activePatientsCount({
    organizationId,
    regionId: null,
    condition: Prisma.sql`p."countyId" IS NULL`,
  });

const PATIENTS_WITHOUT_PRIMARY_NURSE_SQL = ({organizationId, regionId}) =>
  activePatientsCount({
    organizationId,
    regionId,
    condition: Prisma.sql`p."primary_nurse_profile_id" IS NULL`,
  });

const PATIENTS_WITHOUT_CASE_MANAGER_SQL = ({organizationId, regionId}) =>
  activePatientsCount({
    organizationId,
    regionId,
    condition: Prisma.sql`NOT EXISTS (
      SELECT 1 FROM case_manager_patients cmp WHERE cmp."patientId" = p."id"
    )`,
  });

// Compared as calendar days; today is the organization's day.
const PATIENTS_WITHOUT_ACTIVE_CHECKLIST_SQL = ({
  organizationId,
  regionId,
  today,
}) =>
  activePatientsCount({
    organizationId,
    regionId,
    condition: Prisma.sql`NOT EXISTS (
      SELECT 1 FROM checklist_assignments ca
      WHERE ca."patientId" = p."id"
        AND ca."deleted_at" IS NULL
        AND ca."end_date"::date >= ${today}::date
    )`,
  });

const REGIONS_WITHOUT_PRIMARY_DEFAULT_SQL = ({
  organizationId,
  regionId,
}) => Prisma.sql`
  SELECT COUNT(*)::int AS total
  FROM regions r
  WHERE r."organizationId" = ${organizationId}
    AND r."deleted_at" IS NULL
    AND r."isActive" = TRUE
    ${regionId ? Prisma.sql`AND r."id" = ${regionId}` : Prisma.empty}
    AND NOT EXISTS (
      SELECT 1
      FROM region_default_nurses d
      JOIN nurse_profiles np ON np."id" = d."nurseProfileId"
        AND np."deleted_at" IS NULL
        AND np."status"::text = ${ENTITY_STATUSES.ACTIVE.value}::text
      WHERE d."regionId" = r."id"
        AND d."nurseRegionRole"::text = ${NURSE_REGION_ROLES.PRIMARY}::text
    )
`;

// Expired licenses count too. A region scopes nurses by their region membership.
const NURSES_LICENSE_EXPIRING_SQL = ({
  organizationId,
  regionId,
  cutoffDate,
}) => Prisma.sql`
  SELECT COUNT(*)::int AS total
  FROM nurse_profiles np
  WHERE np."organizationId" = ${organizationId}
    AND np."deleted_at" IS NULL
    AND np."status"::text = ${ENTITY_STATUSES.ACTIVE.value}::text
    AND np."licenseExpirationDate" IS NOT NULL
    AND np."licenseExpirationDate"::date < ${cutoffDate}::date
    ${
      regionId
        ? Prisma.sql`AND np."id" IN (
            SELECT nr."nurseProfileId" FROM nurse_regions nr
            WHERE nr."organizationId" = ${organizationId} AND nr."regionId" = ${regionId}
          )`
        : Prisma.empty
    }
`;

module.exports = {
  PATIENTS_WITHOUT_COUNTY_SQL,
  PATIENTS_WITHOUT_PRIMARY_NURSE_SQL,
  PATIENTS_WITHOUT_CASE_MANAGER_SQL,
  PATIENTS_WITHOUT_ACTIVE_CHECKLIST_SQL,
  REGIONS_WITHOUT_PRIMARY_DEFAULT_SQL,
  NURSES_LICENSE_EXPIRING_SQL,
};
