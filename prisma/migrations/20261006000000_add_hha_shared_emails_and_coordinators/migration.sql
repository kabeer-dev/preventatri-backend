-- HHAeXchange shared emails and patient coordinators (PREVENT-732).
--
-- Additive only. users keeps HHA's own address beside the login email, and
-- patients keep every HHA coordinator plus the one an admin chose.

ALTER TABLE "users"
  ADD COLUMN "hha_email" VARCHAR(255),
  ADD COLUMN "is_email_admin_set" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "idx_users_primary_org_hha_email"
  ON "users"("primary_org_id", "hha_email")
  WHERE "hha_email" IS NOT NULL;

ALTER TABLE "patients"
  ADD COLUMN "hha_selected_case_manager_profile_id" TEXT,
  ADD CONSTRAINT "patients_hha_selected_case_manager_profile_id_fkey"
    FOREIGN KEY ("hha_selected_case_manager_profile_id")
    REFERENCES "case_manager_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "patient_hha_coordinators" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "patient_id" TEXT NOT NULL,
  "slot" SMALLINT NOT NULL,
  "hha_coordinator_name" VARCHAR(200) NOT NULL,
  "case_manager_profile_id" TEXT,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "patient_hha_coordinators_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "patient_hha_coordinators_organization_id_fkey" FOREIGN KEY ("organization_id")
    REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "patient_hha_coordinators_patient_id_fkey" FOREIGN KEY ("patient_id")
    REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "patient_hha_coordinators_case_manager_profile_id_fkey" FOREIGN KEY ("case_manager_profile_id")
    REFERENCES "case_manager_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "uq_patient_hha_coordinators_patient_slot"
  ON "patient_hha_coordinators"("patient_id", "slot");

CREATE INDEX "idx_patient_hha_coordinators_org_slot"
  ON "patient_hha_coordinators"("organization_id", "slot");
