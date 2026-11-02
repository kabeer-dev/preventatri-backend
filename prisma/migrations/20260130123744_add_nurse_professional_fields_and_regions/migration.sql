-- CreateEnum
CREATE TYPE "ProfessionalRole" AS ENUM ('RN', 'LPN');

-- CreateEnum
CREATE TYPE "NurseStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateTable
CREATE TABLE "nurse_profiles" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "professionalRole" "ProfessionalRole" NOT NULL,
    "licenseNumber" VARCHAR(50) NOT NULL,
    "licenseState" VARCHAR(2) NOT NULL DEFAULT 'PA',
    "licenseExpirationDate" TIMESTAMP(3) NOT NULL,
    "status" "NurseStatus" NOT NULL DEFAULT 'ACTIVE',
    "npi" VARCHAR(10),
    "onCallIndicator" BOOLEAN NOT NULL DEFAULT false,
    "preferredContactMethod" VARCHAR(50),
    "notes" TEXT,
    "startDate" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "nurse_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "nurse_constraints" (
    "id" TEXT NOT NULL,
    "nurseProfileId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "maxPatientLoad" INTEGER NOT NULL DEFAULT 0,
    "currentPatientCount" INTEGER NOT NULL DEFAULT 0,
    "deleted_at" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "nurse_constraints_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "regions" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "organizationId" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "deleted_at" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "regions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "nurse_regions" (
    "id" TEXT NOT NULL,
    "nurseProfileId" TEXT NOT NULL,
    "regionId" TEXT NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "nurse_regions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "unique_nurse_profile_per_org" ON "nurse_profiles"("userId", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "nurse_constraints_nurseProfileId_key" ON "nurse_constraints"("nurseProfileId");

-- CreateIndex
CREATE UNIQUE INDEX "unique_constraint_per_nurse_org" ON "nurse_constraints"("nurseProfileId", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "unique_region_code_per_org" ON "regions"("code", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "unique_nurse_region_assignment" ON "nurse_regions"("nurseProfileId", "regionId");

-- AddForeignKey
ALTER TABLE "nurse_profiles" ADD CONSTRAINT "nurse_profiles_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nurse_profiles" ADD CONSTRAINT "nurse_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nurse_constraints" ADD CONSTRAINT "nurse_constraints_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nurse_constraints" ADD CONSTRAINT "nurse_constraints_nurseProfileId_fkey" FOREIGN KEY ("nurseProfileId") REFERENCES "nurse_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "regions" ADD CONSTRAINT "regions_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nurse_regions" ADD CONSTRAINT "nurse_regions_nurseProfileId_fkey" FOREIGN KEY ("nurseProfileId") REFERENCES "nurse_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nurse_regions" ADD CONSTRAINT "nurse_regions_regionId_fkey" FOREIGN KEY ("regionId") REFERENCES "regions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
