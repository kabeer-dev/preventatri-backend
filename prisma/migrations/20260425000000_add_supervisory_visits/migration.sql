-- CreateTable
CREATE TABLE "supervisory_visits" (
    "id"                      UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id"         TEXT NOT NULL,
    "patient_id"              TEXT NOT NULL,
    "case_manager_profile_id" TEXT NOT NULL,
    "checklist_template_id"   TEXT NOT NULL,
    "due_date"                DATE NOT NULL,
    "visit_instructions"      TEXT,
    "flag_type"               INTEGER,
    "deleted_at"              TIMESTAMP(3),
    "created_at"              TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"              TIMESTAMP(3) NOT NULL,

    CONSTRAINT "supervisory_visits_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_supervisory_visits_org_patient" ON "supervisory_visits"("organization_id", "patient_id");

-- CreateIndex (partial unique — allows re-scheduling after soft-deletion)
CREATE UNIQUE INDEX "unique_supervisory_visit_per_patient_date" ON "supervisory_visits"("patient_id", "case_manager_profile_id", "due_date") WHERE "deleted_at" IS NULL;

-- CreateIndex
CREATE INDEX "idx_supervisory_visits_case_manager" ON "supervisory_visits"("case_manager_profile_id");

-- AddForeignKey
ALTER TABLE "supervisory_visits" ADD CONSTRAINT "supervisory_visits_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supervisory_visits" ADD CONSTRAINT "supervisory_visits_patient_id_fkey"
    FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supervisory_visits" ADD CONSTRAINT "supervisory_visits_case_manager_profile_id_fkey"
    FOREIGN KEY ("case_manager_profile_id") REFERENCES "case_manager_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supervisory_visits" ADD CONSTRAINT "supervisory_visits_checklist_template_id_fkey"
    FOREIGN KEY ("checklist_template_id") REFERENCES "checklist_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
