/*
  Warnings:

  - You are about to drop the column `roleLabel` on the `caregiver_profiles` table. All the data in the column will be lost.
  - You are about to drop the column `allergies` on the `patients` table. All the data in the column will be lost.
  - You are about to drop the column `currentMedications` on the `patients` table. All the data in the column will be lost.
  - You are about to drop the column `medicalConditions` on the `patients` table. All the data in the column will be lost.

*/
-- AlterTable
-- First add the new column as nullable to allow data migration (using target 50 chars)
ALTER TABLE "caregiver_profiles" ADD COLUMN "role" VARCHAR(50);

-- Migrate existing data from roleLabel to role
UPDATE "caregiver_profiles" SET "role" = CAST("roleLabel" AS TEXT);

-- Set constraints: role should not be null
ALTER TABLE "caregiver_profiles" ALTER COLUMN "role" SET NOT NULL;

-- Now safely drop the old column
ALTER TABLE "caregiver_profiles" DROP COLUMN "roleLabel";

-- AlterTable
ALTER TABLE "patients" DROP COLUMN "allergies",
DROP COLUMN "currentMedications",
DROP COLUMN "medicalConditions";

-- DropEnum
DROP TYPE "CaregiverRoleLabel";
