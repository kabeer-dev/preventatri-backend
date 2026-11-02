-- INACTIVE was never an HHAeXchange status: the sync used it for Waiting,
-- Hospitalized and Hold. Existing INACTIVE patients move to ARCHIVED; the next
-- HHAeXchange sync replaces that with their real status.
UPDATE "patients" SET "status" = 'ARCHIVED' WHERE "status" = 'INACTIVE';

-- Postgres cannot drop an enum value, so the type is rebuilt without it.
ALTER TYPE "PatientStatus" RENAME TO "PatientStatus_old";
CREATE TYPE "PatientStatus" AS ENUM ('ACTIVE', 'WAITING', 'HOSPITALIZED', 'HOLD', 'DISCHARGED', 'ARCHIVED');

ALTER TABLE "patients" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "patients" ALTER COLUMN "status" TYPE "PatientStatus" USING ("status"::text::"PatientStatus");
ALTER TABLE "patients" ALTER COLUMN "status" SET DEFAULT 'ACTIVE';

DROP TYPE "PatientStatus_old";
