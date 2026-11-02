-- Add optional primary/secondary nurse FKs on Region
ALTER TABLE "regions"
  ADD COLUMN "primary_nurse_profile_id"   TEXT,
  ADD COLUMN "secondary_nurse_profile_id" TEXT;

ALTER TABLE "regions"
  ADD CONSTRAINT "regions_primary_nurse_profile_id_fkey"
  FOREIGN KEY ("primary_nurse_profile_id") REFERENCES "nurse_profiles"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "regions"
  ADD CONSTRAINT "regions_secondary_nurse_profile_id_fkey"
  FOREIGN KEY ("secondary_nurse_profile_id") REFERENCES "nurse_profiles"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Prevent the same nurse from occupying both slots on a region
ALTER TABLE "regions"
  ADD CONSTRAINT "region_primary_secondary_nurse_different"
  CHECK (
    "primary_nurse_profile_id" IS NULL
    OR "secondary_nurse_profile_id" IS NULL
    OR "primary_nurse_profile_id" <> "secondary_nurse_profile_id"
  );

CREATE INDEX "idx_regions_primary_nurse"   ON "regions"("primary_nurse_profile_id");
CREATE INDEX "idx_regions_secondary_nurse" ON "regions"("secondary_nurse_profile_id");
