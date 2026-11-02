-- ============================================================
-- Migration: Partial Unique Indexes for Role Profiles
-- ============================================================
-- This migration enables recreating previously deleted role profiles
-- (nurse/caregiver/case_manager) by converting unique constraints to
-- partial indexes that exclude soft-deleted records.
--
-- Root cause: when a role profile (e.g., NurseProfile) is soft-deleted
-- (deleted_at is set), the old full unique index still considers the
-- soft-deleted row, blocking creation of a new profile for the same
-- user+org combination.
--
-- Fix: partial unique indexes with WHERE "deleted_at" IS NULL only
-- enforce uniqueness among active (non-deleted) records. This matches
-- the existing pattern used for User email/phone (unique_email_per_org)
-- and Region code (unique_region_code_per_org).
-- ============================================================

-- NurseProfile: allow recreation after soft-delete
DROP INDEX IF EXISTS "unique_nurse_profile_per_org";
CREATE UNIQUE INDEX "unique_nurse_profile_per_org"
  ON "nurse_profiles"("userId", "organizationId")
  WHERE "deleted_at" IS NULL;

-- CaregiverProfile: allow recreation after soft-delete
DROP INDEX IF EXISTS "unique_caregiver_profile_per_org";
CREATE UNIQUE INDEX "unique_caregiver_profile_per_org"
  ON "caregiver_profiles"("userId", "organizationId")
  WHERE "deleted_at" IS NULL;

-- CaseManagerProfile: allow recreation after soft-delete
DROP INDEX IF EXISTS "unique_case_manager_profile_per_org";
CREATE UNIQUE INDEX "unique_case_manager_profile_per_org"
  ON "case_manager_profiles"("userId", "organizationId")
  WHERE "deleted_at" IS NULL;
