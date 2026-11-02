-- AlterTable: Remove isPrimary from case_manager_regions
-- Primary region concept has been removed from case manager flow
ALTER TABLE "case_manager_regions" DROP COLUMN IF EXISTS "isPrimary";


-- CreateIndex: one patient can only be assigned to one case manager at a time
CREATE UNIQUE INDEX "unique_patient_case_manager_assignment" ON "case_manager_patients"("patientId");
