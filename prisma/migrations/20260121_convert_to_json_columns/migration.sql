-- Migration: Convert flattened User columns to JSON structure (MongoDB parity)
-- This migration consolidates:
-- 1. User: otpEmail, otpPhone -> otps JSON
-- 2. User: secretKeyAuth, secretKeyOtp, secretKeyVerification, secretKeyInvitation, secretKeyLoginReset -> secretKeys JSON
-- 3. Permission: usersViewAccess, usersUpdateAccess, entitiesViewAccess, entitiesUpdateAccess -> levels JSON

-- Step 1: Drop old partial unique indexes before altering the table
DROP INDEX IF EXISTS "unique_email_per_org";
DROP INDEX IF EXISTS "unique_phone_per_org";

-- Step 2: Add new JSON columns to User table with proper defaults
ALTER TABLE "users" ADD COLUMN "otps" jsonb NOT NULL DEFAULT '{"email":null,"phone":null}';
ALTER TABLE "users" ADD COLUMN "secret_keys" jsonb NOT NULL DEFAULT '{"auth":null,"otp":null,"verification":null,"invitation":null,"loginReset":null}';

-- Step 3: Add new levels JSON column to Permission table
ALTER TABLE "permissions" ADD COLUMN "levels" jsonb NOT NULL DEFAULT '{"users":{"view":[],"update":[]},"entities":{"view":[],"update":[]}}';

-- Step 4: Drop old columns from User table (since no production data exists)
ALTER TABLE "users" DROP COLUMN "otp_email";
ALTER TABLE "users" DROP COLUMN "otp_phone";
ALTER TABLE "users" DROP COLUMN "secret_key_auth";
ALTER TABLE "users" DROP COLUMN "secret_key_otp";
ALTER TABLE "users" DROP COLUMN "secret_key_verification";
ALTER TABLE "users" DROP COLUMN "secret_key_invitation";
ALTER TABLE "users" DROP COLUMN "secret_key_login_reset";

-- Step 5: Drop old columns from Permission table (since no production data exists)
ALTER TABLE "permissions" DROP COLUMN "users_view_access";
ALTER TABLE "permissions" DROP COLUMN "users_update_access";
ALTER TABLE "permissions" DROP COLUMN "entities_view_access";
ALTER TABLE "permissions" DROP COLUMN "entities_update_access";

-- Step 6: Recreate partial unique indexes for soft delete + organization scoping
-- Partial unique index for email per organization (allows reuse if deleted or different org)
CREATE UNIQUE INDEX "unique_email_per_org" ON "users"("email", "primary_org_id") WHERE "deleted_at" IS NULL;

-- Partial unique index for phone per organization (allows reuse if deleted or different org)
CREATE UNIQUE INDEX "unique_phone_per_org" ON "users"("phoneNo", "primary_org_id") WHERE "deleted_at" IS NULL;
