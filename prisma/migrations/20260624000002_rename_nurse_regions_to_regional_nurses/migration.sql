-- Rename the nurse_regions table to regional_nurses.
-- The unique constraint and enum type names are unchanged.
-- Only the table name and the org/region index are renamed to reflect the new name.

ALTER TABLE "nurse_regions" RENAME TO "regional_nurses";

ALTER INDEX "idx_nurse_regions_org_region" RENAME TO "idx_regional_nurses_org_region";
