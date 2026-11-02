-- Rename the regional_nurses table back to nurse_regions.
-- The unique constraint (unique_nurse_region_assignment) and enum type names are unchanged.
-- Only the table name and the org/region index are renamed to reflect the new model name (NurseRegion).
-- This is a metadata-only rename in Postgres: all rows, foreign keys and indexes are preserved.

ALTER TABLE "regional_nurses" RENAME TO "nurse_regions";

ALTER INDEX "idx_regional_nurses_org_region" RENAME TO "idx_nurse_regions_org_region";
