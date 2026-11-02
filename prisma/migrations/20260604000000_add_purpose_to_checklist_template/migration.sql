-- CreateEnum
CREATE TYPE "ChecklistTemplatePurpose" AS ENUM ('GENERAL', 'FOLLOW_UP', 'SUPERVISORY_VISIT');

-- AlterTable
ALTER TABLE "checklist_templates" ADD COLUMN "purpose" "ChecklistTemplatePurpose" NOT NULL DEFAULT 'GENERAL';
