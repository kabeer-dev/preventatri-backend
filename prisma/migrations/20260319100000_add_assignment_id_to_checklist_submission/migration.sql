-- AlterTable
ALTER TABLE "checklist_submissions" ADD COLUMN "assignmentId" TEXT NOT NULL;

-- CreateIndex
CREATE INDEX "idx_checklist_submissions_assignment" ON "checklist_submissions"("assignmentId");

-- AddForeignKey
ALTER TABLE "checklist_submissions" ADD CONSTRAINT "checklist_submissions_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "checklist_assignments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
