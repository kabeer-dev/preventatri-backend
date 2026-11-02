-- Drop legacy single-FK nurse columns from regions table.
-- Data has already been migrated to the nurse_regions junction table
-- (see 20260624000000_backfill_region_nurses_to_nurse_regions).

DROP INDEX IF EXISTS "idx_regions_primary_nurse";
DROP INDEX IF EXISTS "idx_regions_secondary_nurse";

ALTER TABLE "regions" DROP CONSTRAINT IF EXISTS "region_primary_secondary_nurse_different";
ALTER TABLE "regions" DROP CONSTRAINT IF EXISTS "regions_primary_nurse_profile_id_fkey";
ALTER TABLE "regions" DROP CONSTRAINT IF EXISTS "regions_secondary_nurse_profile_id_fkey";

ALTER TABLE "regions" DROP COLUMN "primary_nurse_profile_id";
ALTER TABLE "regions" DROP COLUMN "secondary_nurse_profile_id";
