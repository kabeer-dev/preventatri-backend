-- CreateTable
CREATE TABLE "follow_up_tasks" (
    "id"                         UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id"            TEXT NOT NULL,
    "patient_id"                 TEXT NOT NULL,
    "case_manager_profile_id"    TEXT NOT NULL,
    "checklist_template_id"      TEXT,
    "due_date"                   DATE NOT NULL,
    "visit_instructions"         TEXT,
    "flag_type"                  INTEGER,
    "status"                     TEXT NOT NULL DEFAULT 'PENDING',
    "answers"                    JSONB NOT NULL DEFAULT '[]',
    "case_manager_reply"         TEXT,
    "case_manager_reply_files"   JSONB,
    "completion_notes"           TEXT,
    "completion_source"          TEXT,
    "completed_at"               TIMESTAMP(3),
    "deleted_at"                 TIMESTAMP(3),
    "created_at"                 TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"                 TIMESTAMP(3) NOT NULL,

    CONSTRAINT "follow_up_tasks_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "follow_up_tasks_template_or_instructions_chk"
        CHECK ("checklist_template_id" IS NOT NULL OR "visit_instructions" IS NOT NULL)
);

-- CreateIndex
CREATE INDEX "idx_follow_up_tasks_org_patient" ON "follow_up_tasks"("organization_id", "patient_id");

-- CreateIndex
CREATE INDEX "idx_follow_up_tasks_case_manager" ON "follow_up_tasks"("case_manager_profile_id");

-- CreateIndex (partial unique — allows re-scheduling after soft-deletion)
CREATE UNIQUE INDEX "unique_follow_up_task_per_day" ON "follow_up_tasks"("patient_id", "case_manager_profile_id", "due_date") WHERE "deleted_at" IS NULL;

-- AddForeignKey
ALTER TABLE "follow_up_tasks" ADD CONSTRAINT "follow_up_tasks_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "follow_up_tasks" ADD CONSTRAINT "follow_up_tasks_patient_id_fkey"
    FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "follow_up_tasks" ADD CONSTRAINT "follow_up_tasks_case_manager_profile_id_fkey"
    FOREIGN KEY ("case_manager_profile_id") REFERENCES "case_manager_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "follow_up_tasks" ADD CONSTRAINT "follow_up_tasks_checklist_template_id_fkey"
    FOREIGN KEY ("checklist_template_id") REFERENCES "checklist_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;
