-- CreateIndex
CREATE INDEX "idx_submission_flags_org_created" ON "submission_flags"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "idx_checklist_submissions_org_due" ON "checklist_submissions"("organizationId", "due_date");

-- CreateIndex
CREATE INDEX "idx_follow_up_tasks_org_created" ON "follow_up_tasks"("organization_id", "created_at");
