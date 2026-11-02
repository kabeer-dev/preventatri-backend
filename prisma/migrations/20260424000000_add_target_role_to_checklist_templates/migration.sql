-- AlterTable: Add target_role to checklist_templates using existing SystemRole enum
-- Reuses the SystemRole enum already defined in the database.

-- Add column as nullable first to handle existing rows
ALTER TABLE "checklist_templates" ADD COLUMN "target_role" "SystemRole";

-- Backfill: all existing templates are caregiver-targeted
UPDATE "checklist_templates" SET "target_role" = 'caregiver';

-- Enforce NOT NULL now that all rows have a value
ALTER TABLE "checklist_templates" ALTER COLUMN "target_role" SET NOT NULL;
