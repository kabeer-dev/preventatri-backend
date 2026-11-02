-- Add optional primary/secondary nurse FKs on Patient
-- Idempotent so it can recover from a partially-applied prior run.
ALTER TABLE "patients"
  ADD COLUMN IF NOT EXISTS "primary_nurse_profile_id"   TEXT,
  ADD COLUMN IF NOT EXISTS "secondary_nurse_profile_id" TEXT;

DO $$ BEGIN
  ALTER TABLE "patients"
    ADD CONSTRAINT "patients_primary_nurse_profile_id_fkey"
    FOREIGN KEY ("primary_nurse_profile_id") REFERENCES "nurse_profiles"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "patients"
    ADD CONSTRAINT "patients_secondary_nurse_profile_id_fkey"
    FOREIGN KEY ("secondary_nurse_profile_id") REFERENCES "nurse_profiles"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Prevent the same nurse from occupying both slots on a patient
DO $$ BEGIN
  ALTER TABLE "patients"
    ADD CONSTRAINT "patient_primary_secondary_nurse_different"
    CHECK (
      "primary_nurse_profile_id" IS NULL
      OR "secondary_nurse_profile_id" IS NULL
      OR "primary_nurse_profile_id" <> "secondary_nurse_profile_id"
    );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "idx_patients_primary_nurse"   ON "patients"("primary_nurse_profile_id");
CREATE INDEX IF NOT EXISTS "idx_patients_secondary_nurse" ON "patients"("secondary_nurse_profile_id");
