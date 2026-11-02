const {Prisma} = require('../../generated/prisma/client');

// Column names reach Prisma.raw only from literals in the reports SQL files,
// never from request input.

const utcInstant = ({column}) =>
  Prisma.sql`(${Prisma.raw(column)} AT TIME ZONE 'UTC')`;

const bucketLabel = ({instant, window}) =>
  Prisma.sql`to_char(date_trunc(${window.grain}::text, ${instant} AT TIME ZONE ${window.timeZone}::text), 'YYYY-MM-DD')`;

const inWindow = ({instant, window}) =>
  Prisma.sql`${instant} >= ${window.startISO}::timestamptz AND ${instant} < ${window.endISO}::timestamptz`;

// A record's region is its patient's current county's region.
const patientRegionScope = ({patientIdColumn, regionId}) =>
  regionId
    ? Prisma.sql`AND ${Prisma.raw(patientIdColumn)} IN (
        SELECT sp."id" FROM patients sp
        JOIN counties sc ON sc."id" = sp."countyId"
        WHERE sc."regionId" = ${regionId}
      )`
    : Prisma.empty;

// Region plus the person filters, each read as that person's patients.
const patientScope = ({patientIdColumn, scope}) => {
  const column = Prisma.raw(patientIdColumn);
  const clauses = [];

  if (scope?.caregiverUserId)
    clauses.push(Prisma.sql`AND ${column} IN (
      SELECT cp."patientId" FROM caregiver_patients cp
      JOIN caregiver_profiles cpr ON cpr."id" = cp."caregiverProfileId"
      WHERE cpr."userId" = ${scope.caregiverUserId}
    )`);

  if (scope?.caseManagerUserId)
    clauses.push(Prisma.sql`AND ${column} IN (
      SELECT cmp."patientId" FROM case_manager_patients cmp
      JOIN case_manager_profiles cmpr ON cmpr."id" = cmp."caseManagerProfileId"
      WHERE cmpr."userId" = ${scope.caseManagerUserId}
    )`);

  if (scope?.nurseUserId)
    clauses.push(Prisma.sql`AND ${column} IN (
      SELECT np."id" FROM patients np
      JOIN nurse_profiles npr ON npr."id" IN (
        np."primary_nurse_profile_id", np."secondary_nurse_profile_id"
      )
      WHERE npr."userId" = ${scope.nurseUserId}
    )`);

  if (scope?.patientId)
    clauses.push(Prisma.sql`AND ${column} = ${scope.patientId}`);

  return Prisma.join(
    [patientRegionScope({patientIdColumn, regionId: scope?.regionId})].concat(
      clauses
    ),
    ' '
  );
};

const patientRegionColumn = ({patientIdColumn}) =>
  Prisma.sql`(
    SELECT rc."regionId" FROM patients rp
    JOIN counties rc ON rc."id" = rp."countyId"
    WHERE rp."id" = ${Prisma.raw(patientIdColumn)}
  )`;

module.exports = {
  bucketLabel,
  inWindow,
  patientRegionColumn,
  patientRegionScope,
  patientScope,
  utcInstant,
};
