const {ESCALATABLE_FLAGS} = require('./riskCalcConstants');
const {SUBMISSION_FLAG_STATUS} = require('./submissionFlagConstants');

const {Prisma} = require('../generated/prisma/client');

// Patients whose newest non-voided RED or YELLOW flag is one of `flags`.
// Raw SQL because Prisma cannot filter on the newest related row.
const PATIENT_IDS_BY_LAST_FLAG = ({organizationId, flags, caregiverId}) => {
  const caregiverScope = caregiverId
    ? Prisma.sql`AND f."submitted_by" IN (
        SELECT cp."userId" FROM "caregiver_profiles" cp WHERE cp."id" = ${caregiverId}
      )`
    : Prisma.empty;

  return Prisma.sql`
    SELECT last_flag.patient_id AS id
    FROM (
      SELECT DISTINCT ON (f."patientId")
        f."patientId" AS patient_id,
        f."flag"::text AS flag
      FROM "submission_flags" f
      WHERE f."organizationId" = ${organizationId}
        AND f."deleted_at" IS NULL
        AND f."status"::text <> ${SUBMISSION_FLAG_STATUS.VOIDED}
        AND f."flag"::text IN (${Prisma.join(ESCALATABLE_FLAGS)})
        ${caregiverScope}
      ORDER BY f."patientId", f."createdAt" DESC
    ) last_flag
    WHERE last_flag.flag IN (${Prisma.join(flags)})
  `;
};

module.exports = {PATIENT_IDS_BY_LAST_FLAG};
