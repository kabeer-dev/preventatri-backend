-- CreateEnum
CREATE TYPE "CaregiverRoleLabel" AS ENUM ('PCA', 'HHA', 'FAMILY_CAREGIVER');

-- CreateEnum
CREATE TYPE "CaregiverStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "PatientStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'DISCHARGED');

-- CreateEnum
CREATE TYPE "CaseManagerStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "RiskLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "SystemRole" ADD VALUE 'caregiver';
ALTER TYPE "SystemRole" ADD VALUE 'case_manager';

-- CreateTable
CREATE TABLE "caregiver_profiles" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "roleLabel" "CaregiverRoleLabel" NOT NULL DEFAULT 'PCA',
    "status" "CaregiverStatus" NOT NULL DEFAULT 'ACTIVE',
    "relationshipToPatient" VARCHAR(100),
    "preferredContactMethod" VARCHAR(50),
    "language" VARCHAR(10),
    "notes" TEXT,
    "startDate" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "caregiver_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "caregiver_patients" (
    "id" TEXT NOT NULL,
    "caregiverProfileId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "caregiver_patients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "patients" (
    "id" TEXT NOT NULL,
    "firstName" VARCHAR(100) NOT NULL,
    "lastName" VARCHAR(100) NOT NULL,
    "dateOfBirth" TIMESTAMP(3) NOT NULL,
    "gender" VARCHAR(20),
    "countyId" TEXT NOT NULL,
    "regionId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "status" "PatientStatus" NOT NULL DEFAULT 'ACTIVE',
    "address" VARCHAR(500),
    "city" VARCHAR(100),
    "state" VARCHAR(50),
    "zipCode" VARCHAR(10),
    "email" VARCHAR(255),
    "phone" VARCHAR(20),
    "emergencyContact" VARCHAR(255),
    "medicaidId" VARCHAR(50),
    "medicalConditions" TEXT,
    "allergies" TEXT,
    "currentMedications" TEXT,
    "diagnoses" TEXT,
    "notes" TEXT,
    "riskLevel" "RiskLevel",
    "deleted_at" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "patients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "case_manager_profiles" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "status" "CaseManagerStatus" NOT NULL DEFAULT 'ACTIVE',
    "maxPatientLoad" INTEGER,
    "preferredContactMethod" VARCHAR(50),
    "notes" TEXT,
    "deleted_at" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "case_manager_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "case_manager_regions" (
    "id" TEXT NOT NULL,
    "caseManagerProfileId" TEXT NOT NULL,
    "regionId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "case_manager_regions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "unique_caregiver_profile_per_org" ON "caregiver_profiles"("userId", "organizationId");

-- CreateIndex
CREATE INDEX "idx_caregiver_patients_org" ON "caregiver_patients"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "unique_caregiver_patient_assignment" ON "caregiver_patients"("caregiverProfileId", "patientId");

-- CreateIndex
CREATE INDEX "idx_patients_org_region" ON "patients"("organizationId", "regionId");

-- CreateIndex
CREATE INDEX "idx_patients_org_county" ON "patients"("organizationId", "countyId");

-- CreateIndex
CREATE UNIQUE INDEX "unique_case_manager_profile_per_org" ON "case_manager_profiles"("userId", "organizationId");

-- CreateIndex
CREATE INDEX "idx_case_manager_regions_org_region" ON "case_manager_regions"("organizationId", "regionId");

-- CreateIndex
CREATE UNIQUE INDEX "unique_case_manager_region_assignment" ON "case_manager_regions"("caseManagerProfileId", "regionId");

-- AddForeignKey
ALTER TABLE "caregiver_profiles" ADD CONSTRAINT "caregiver_profiles_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "caregiver_profiles" ADD CONSTRAINT "caregiver_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "caregiver_patients" ADD CONSTRAINT "caregiver_patients_caregiverProfileId_fkey" FOREIGN KEY ("caregiverProfileId") REFERENCES "caregiver_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "caregiver_patients" ADD CONSTRAINT "caregiver_patients_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "caregiver_patients" ADD CONSTRAINT "caregiver_patients_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patients" ADD CONSTRAINT "patients_countyId_fkey" FOREIGN KEY ("countyId") REFERENCES "counties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patients" ADD CONSTRAINT "patients_regionId_fkey" FOREIGN KEY ("regionId") REFERENCES "regions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patients" ADD CONSTRAINT "patients_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_manager_profiles" ADD CONSTRAINT "case_manager_profiles_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_manager_profiles" ADD CONSTRAINT "case_manager_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_manager_regions" ADD CONSTRAINT "case_manager_regions_caseManagerProfileId_fkey" FOREIGN KEY ("caseManagerProfileId") REFERENCES "case_manager_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_manager_regions" ADD CONSTRAINT "case_manager_regions_regionId_fkey" FOREIGN KEY ("regionId") REFERENCES "regions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_manager_regions" ADD CONSTRAINT "case_manager_regions_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
