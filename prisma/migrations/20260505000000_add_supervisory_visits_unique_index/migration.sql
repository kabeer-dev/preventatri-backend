-- The original migration 20260425000000_add_supervisory_visits declared a
-- partial unique index that never made it into the database. Re-add it here.
CREATE UNIQUE INDEX "unique_supervisory_visit_per_patient_date"
    ON "supervisory_visits" ("patient_id", "case_manager_profile_id", "due_date")
    WHERE "deleted_at" IS NULL;
