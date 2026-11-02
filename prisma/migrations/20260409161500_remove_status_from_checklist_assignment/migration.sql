-- Drop the status column from checklist_assignments table
ALTER TABLE "checklist_assignments" DROP COLUMN IF EXISTS "status";
