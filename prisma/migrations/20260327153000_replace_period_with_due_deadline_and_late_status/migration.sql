-- Add LATE value to ChecklistSubmissionStatus enum
ALTER TYPE "ChecklistSubmissionStatus" ADD VALUE 'LATE';

-- Add new columns
ALTER TABLE "checklist_submissions" ADD COLUMN "due_date" TIMESTAMP(3);
ALTER TABLE "checklist_submissions" ADD COLUMN "deadline" TIMESTAMP(3);

-- Drop old unique constraint and index
DROP INDEX IF EXISTS "unique_assignment_period";
DROP INDEX IF EXISTS "idx_checklist_submissions_status_period";

-- Remove old columns
ALTER TABLE "checklist_submissions" DROP COLUMN IF EXISTS "period_start";
ALTER TABLE "checklist_submissions" DROP COLUMN IF EXISTS "period_end";

-- Create new unique constraint
CREATE UNIQUE INDEX "unique_assignment_period" ON "checklist_submissions"("assignmentId", "due_date");

-- Create new index
CREATE INDEX "idx_checklist_submissions_status_deadline" ON "checklist_submissions"("status", "deadline");
