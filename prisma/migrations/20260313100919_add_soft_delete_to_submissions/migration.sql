-- AlterTable
ALTER TABLE "checklist_submission_answers" ADD COLUMN     "deleted_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "checklist_submissions" ADD COLUMN     "deleted_at" TIMESTAMP(3);
