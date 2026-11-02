-- 1. Create the enum type
CREATE TYPE "NurseRegionRole" AS ENUM ('PRIMARY', 'SECONDARY');

-- 2. Add the new column (nullable temporarily so we can backfill)
ALTER TABLE "nurse_regions" ADD COLUMN "nurseRegionRole" "NurseRegionRole";

-- 3. Backfill from existing isPrimary values:
--    isPrimary = true   -> PRIMARY
--    isPrimary = false  -> SECONDARY (any other row)
UPDATE "nurse_regions"
SET "nurseRegionRole" = CASE
  WHEN "isPrimary" = true THEN 'PRIMARY'::"NurseRegionRole"
  ELSE 'SECONDARY'::"NurseRegionRole"
END;

-- 4. Lock it down: NOT NULL
ALTER TABLE "nurse_regions" ALTER COLUMN "nurseRegionRole" SET NOT NULL;

-- 5. Drop the legacy boolean (no longer needed)
ALTER TABLE "nurse_regions" DROP COLUMN "isPrimary";

-- 6. Safety: drop the partial unique index if still present from earlier history
DROP INDEX IF EXISTS "unique_primary_region_per_nurse";
