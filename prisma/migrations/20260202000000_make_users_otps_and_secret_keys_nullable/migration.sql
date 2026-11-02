-- Make users.otps and users.secret_keys columns nullable
-- These fields are used as optional JSON in the application
-- This migration aligns the schema with the actual application behavior

-- AlterTable
ALTER TABLE "users" ALTER COLUMN "otps" DROP NOT NULL,
ALTER COLUMN "secret_keys" DROP NOT NULL;
