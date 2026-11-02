-- AlterTable: Add missing fields to case_manager_profiles
ALTER TABLE "case_manager_profiles" ADD COLUMN "language" VARCHAR(10);
ALTER TABLE "case_manager_profiles" ADD COLUMN "startDate" TIMESTAMP(3);
ALTER TABLE "case_manager_profiles" ADD COLUMN "title" VARCHAR(100);

-- CreateTable: Junction table for CaseManager <-> Patient
CREATE TABLE "case_manager_patients" (
    "id" TEXT NOT NULL,
    "caseManagerProfileId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "case_manager_patients_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_case_manager_patients_org" ON "case_manager_patients"("organizationId");


-- AddForeignKey
ALTER TABLE "case_manager_patients" ADD CONSTRAINT "case_manager_patients_caseManagerProfileId_fkey" FOREIGN KEY ("caseManagerProfileId") REFERENCES "case_manager_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_manager_patients" ADD CONSTRAINT "case_manager_patients_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_manager_patients" ADD CONSTRAINT "case_manager_patients_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
