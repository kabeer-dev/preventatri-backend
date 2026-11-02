-- RenameColumn
ALTER TABLE "checklist_submissions" RENAME COLUMN "userId" TO "assigneeId";

-- RenameIndex (optional: update the index name for clarity)
ALTER INDEX "idx_checklist_submissions_caregiver" RENAME TO "idx_checklist_submissions_assignee";

-- RenameForeignKey
ALTER TABLE "checklist_submissions" RENAME CONSTRAINT "checklist_submissions_userId_fkey" TO "checklist_submissions_assigneeId_fkey";
