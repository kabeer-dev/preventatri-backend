/*
  Warnings:

  - You are about to drop the column `maxPatientLoad` on the `case_manager_profiles` table. All the data in the column will be lost.
  - You are about to drop the column `stateCode` on the `counties` table. All the data in the column will be lost.
  - You are about to drop the column `regionId` on the `patients` table. All the data in the column will be lost.
  - You are about to drop the `nurse_constraints` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "nurse_constraints" DROP CONSTRAINT "nurse_constraints_nurseProfileId_fkey";

-- DropForeignKey
ALTER TABLE "nurse_constraints" DROP CONSTRAINT "nurse_constraints_organizationId_fkey";

-- DropForeignKey
ALTER TABLE "patients" DROP CONSTRAINT "patients_regionId_fkey";

-- DropIndex
DROP INDEX "idx_patients_org_region";

-- AlterTable
ALTER TABLE "case_manager_profiles" DROP COLUMN "maxPatientLoad";

-- AlterTable
ALTER TABLE "counties" DROP COLUMN "stateCode";

-- AlterTable
ALTER TABLE "patients" DROP COLUMN "regionId";

-- DropTable
DROP TABLE "nurse_constraints";
