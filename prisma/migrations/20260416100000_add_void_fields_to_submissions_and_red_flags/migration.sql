-- AlterEnum
ALTER TYPE "ChecklistSubmissionStatus" ADD VALUE 'VOIDED';

-- AlterTable: Add void fields to checklist_submissions
ALTER TABLE "checklist_submissions" ADD COLUMN "void_reason" TEXT;
ALTER TABLE "checklist_submissions" ADD COLUMN "voided_at" TIMESTAMP(3);

-- AlterTable: Add void fields to red_flags
ALTER TABLE "red_flags" ADD COLUMN "void_reason" TEXT;
ALTER TABLE "red_flags" ADD COLUMN "voided_at" TIMESTAMP(3);
