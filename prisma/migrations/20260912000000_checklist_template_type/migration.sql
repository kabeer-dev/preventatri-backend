-- Checklist templates: replace target_role with a real type, and rename the
-- INACTIVE status to ARCHIVED. Existing rows default to GENERAL, which the
-- rename turns into PATIENT; only the two case manager forms need a backfill.
UPDATE "checklist_templates"
SET "purpose" = 'SUPERVISORY_VISIT'
WHERE "title" = 'Supervisory Visit Form';

-- Title carries an en-dash, so match on the prefix rather than the full string.
UPDATE "checklist_templates"
SET "purpose" = 'FOLLOW_UP'
WHERE "title" LIKE 'Monthly Wellness Call%';

ALTER TYPE "ChecklistTemplatePurpose" RENAME VALUE 'GENERAL' TO 'PATIENT';
ALTER TYPE "ChecklistTemplatePurpose" RENAME TO "ChecklistTemplateType";
ALTER TABLE "checklist_templates" RENAME COLUMN "purpose" TO "type";
ALTER TABLE "checklist_templates" ALTER COLUMN "type" SET DEFAULT 'PATIENT';

ALTER TYPE "ChecklistTemplateStatus" RENAME VALUE 'INACTIVE' TO 'ARCHIVED';

ALTER TABLE "checklist_templates" DROP COLUMN "target_role";
