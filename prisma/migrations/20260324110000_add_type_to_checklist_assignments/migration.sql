-- CreateEnum
CREATE TYPE "ChecklistAssignmentType" AS ENUM ('DAILY', 'WEEKLY', 'MONTHLY');

-- AlterTable: add column as nullable first, backfill existing rows, then enforce NOT NULL
ALTER TABLE "checklist_assignments" ADD COLUMN "type" "ChecklistAssignmentType";
UPDATE "checklist_assignments" SET "type" = 'DAILY' WHERE "type" IS NULL;
ALTER TABLE "checklist_assignments" ALTER COLUMN "type" SET NOT NULL;
