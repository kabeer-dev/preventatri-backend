-- HHAeXchange derived-field ownership.
--
-- Patient county and a nurse's PRIMARY regions are derived from the HHA
-- address. While the ZIP resolves, sync owns the value and the API refuses
-- edits; when it does not, the flag drops and an admin may set it. No backfill:
-- the next sync run sets both flags.

ALTER TABLE "patients"
  ADD COLUMN "is_county_hha_managed" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "nurse_profiles"
  ADD COLUMN "is_primary_region_hha_managed" BOOLEAN NOT NULL DEFAULT false;
