-- The super admin approves, rejects, suspends and reactivates organizations.
-- It is a membership role in its own seeded organization, and an organization
-- can now be rejected or suspended as well as pending or active.
--
-- Additive only, and safe to run on a database where a value or column was
-- already added by hand.

ALTER TYPE "SystemRole" ADD VALUE IF NOT EXISTS 'super_admin';

ALTER TYPE "OrganizationStatus" ADD VALUE IF NOT EXISTS 'rejected';
ALTER TYPE "OrganizationStatus" ADD VALUE IF NOT EXISTS 'suspended';

ALTER TABLE "organizations"
  ADD COLUMN IF NOT EXISTS "status_changed_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "status_reason" VARCHAR(1000);
