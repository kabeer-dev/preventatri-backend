-- ============================================================
-- Rename red_flags -> submission_flags and add unified flag columns.
-- Data-preserving: ALTER ... RENAME the existing table in place
-- instead of letting Prisma DROP + CREATE (which would wipe all rows).
-- Every existing red_flag becomes a MANUAL / RED / HIGH submission_flag.
-- ============================================================

-- CreateEnum
CREATE TYPE "FlagType" AS ENUM ('AUTO', 'MANUAL');

-- CreateEnum
CREATE TYPE "FlagStatus" AS ENUM ('PENDING', 'VOIDED', 'RESOLVED');

-- Rename the table (preserves rows, PK, FKs, indexes)
ALTER TABLE "red_flags" RENAME TO "submission_flags";

-- Rename primary key constraint
ALTER TABLE "submission_flags" RENAME CONSTRAINT "red_flags_pkey" TO "submission_flags_pkey";

-- Rename existing foreign key constraints
ALTER TABLE "submission_flags" RENAME CONSTRAINT "red_flags_patientId_fkey" TO "submission_flags_patientId_fkey";
ALTER TABLE "submission_flags" RENAME CONSTRAINT "red_flags_organizationId_fkey" TO "submission_flags_organizationId_fkey";
ALTER TABLE "submission_flags" RENAME CONSTRAINT "red_flags_submitted_by_fkey" TO "submission_flags_submitted_by_fkey";

-- Rename existing indexes
ALTER INDEX "idx_red_flags_org" RENAME TO "idx_submission_flags_org";
ALTER INDEX "idx_red_flags_submitter" RENAME TO "idx_submission_flags_submitter";
ALTER INDEX "idx_red_flags_patient" RENAME TO "idx_submission_flags_patient";

-- Add new columns (nullable first, so we can backfill existing rows)
ALTER TABLE "submission_flags" ADD COLUMN "submissionId" TEXT;
ALTER TABLE "submission_flags" ADD COLUMN "flag" "ChecklistRiskFlag";
ALTER TABLE "submission_flags" ADD COLUMN "category" "RiskCategory";
ALTER TABLE "submission_flags" ADD COLUMN "score" INTEGER;
ALTER TABLE "submission_flags" ADD COLUMN "type" "FlagType";
ALTER TABLE "submission_flags" ADD COLUMN "status" "FlagStatus" NOT NULL DEFAULT 'PENDING';

-- Backfill existing rows.
-- Every existing red_flag is a MANUAL flag at RED/HIGH severity.
-- status mirrors voided_at so already-voided flags retain their state.
UPDATE "submission_flags"
SET "flag"     = 'RED',
    "category" = 'HIGH',
    "type"     = 'MANUAL',
    "status"   = CASE
                   WHEN "voided_at" IS NOT NULL THEN 'VOIDED'::"FlagStatus"
                   ELSE 'PENDING'::"FlagStatus"
                 END;

-- Enforce NOT NULL after backfill
ALTER TABLE "submission_flags" ALTER COLUMN "flag" SET NOT NULL;
ALTER TABLE "submission_flags" ALTER COLUMN "category" SET NOT NULL;
ALTER TABLE "submission_flags" ALTER COLUMN "type" SET NOT NULL;

-- New index + FK for submissionId (links AUTO flags to their ChecklistSubmission)
CREATE INDEX "idx_submission_flags_submission" ON "submission_flags"("submissionId");

ALTER TABLE "submission_flags"
  ADD CONSTRAINT "submission_flags_submissionId_fkey"
  FOREIGN KEY ("submissionId") REFERENCES "checklist_submissions"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
