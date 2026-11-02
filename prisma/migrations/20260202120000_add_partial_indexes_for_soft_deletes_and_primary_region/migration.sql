-- =============================================================================
-- MIGRATION: Add Partial Indexes for Soft Deletes and Primary Region Uniqueness
-- =============================================================================
-- 
-- IMPORTANT: This migration creates partial unique indexes which Prisma 5.22
-- does NOT support in schema syntax (@@unique doesn't allow WHERE clauses).
-- The actual database constraints are created here, but the schema only documents
-- them in comments. This is a known limitation and the correct approach.
--
-- See: prisma/schema.prisma for detailed documentation
-- =============================================================================

-- Fix 1: Replace the full unique index on regions(code, organizationId) with a partial one
-- that excludes soft-deleted records, allowing code reuse after soft deletion
-- 
-- PROBLEM: Without the WHERE clause, soft-deleted regions block recreation of
--          regions with the same code in the same organization.
--
-- SOLUTION: Use a partial unique index that only applies to active (non-deleted) records.
--           This allows:
--           - Code reuse after soft deletion
--           - Multiple "deleted" records with same code
--           - Proper multi-tenancy with organizationId scoping
--
-- USAGE: regionsServices.getRegionByCode() explicitly filters isDeleted: null
--        to honor this constraint properly.
DROP INDEX IF EXISTS "unique_region_code_per_org";

CREATE UNIQUE INDEX "unique_region_code_per_org" 
ON "regions"("code", "organizationId") 
WHERE "deleted_at" IS NULL;

-- Fix 2: Add partial unique index to enforce at most one primary region per nurse
-- 
-- PROBLEM: The isPrimary boolean field had no database-level constraint,
--          allowing multiple regions to be marked as primary for the same nurse.
--
-- SOLUTION: Create a partial unique index that only applies to primary=true records.
--           Combined with application-level logic in nursesServices.addNurseToRegion()
--           this ensures atomic primary region assignment.
--
-- USAGE: nursesServices.addNurseToRegion() clears other primary flags before
--        creating/updating with isPrimary=true, and database rejects duplicates.
DROP INDEX IF EXISTS "unique_primary_region_per_nurse";

CREATE UNIQUE INDEX "unique_primary_region_per_nurse" 
ON "nurse_regions"("nurseProfileId") 
WHERE "isPrimary" = true;
