-- CreateEnum
CREATE TYPE "ChecklistAssignmentStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'CANCELLED');

-- CreateTable
CREATE TABLE "checklist_assignments" (
    "id" TEXT NOT NULL,
    "checklistTemplateId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "caregiverProfileId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "assigned_by" TEXT NOT NULL,
    "start_date" TIMESTAMP(3) NOT NULL,
    "end_date" TIMESTAMP(3) NOT NULL,
    "notes" TEXT,
    "status" "ChecklistAssignmentStatus" NOT NULL DEFAULT 'ACTIVE',
    "deleted_at" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "checklist_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_checklist_assignments_org" ON "checklist_assignments"("organizationId");

-- CreateIndex
CREATE INDEX "idx_checklist_assignments_patient" ON "checklist_assignments"("patientId");

-- CreateIndex
CREATE INDEX "idx_checklist_assignments_caregiver_profile" ON "checklist_assignments"("caregiverProfileId");

-- CreateIndex
CREATE INDEX "idx_checklist_assignments_template" ON "checklist_assignments"("checklistTemplateId");

-- AddForeignKey
ALTER TABLE "checklist_assignments" ADD CONSTRAINT "checklist_assignments_checklistTemplateId_fkey" FOREIGN KEY ("checklistTemplateId") REFERENCES "checklist_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checklist_assignments" ADD CONSTRAINT "checklist_assignments_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checklist_assignments" ADD CONSTRAINT "checklist_assignments_caregiverProfileId_fkey" FOREIGN KEY ("caregiverProfileId") REFERENCES "caregiver_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checklist_assignments" ADD CONSTRAINT "checklist_assignments_assigned_by_fkey" FOREIGN KEY ("assigned_by") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checklist_assignments" ADD CONSTRAINT "checklist_assignments_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
