-- CreateEnum
CREATE TYPE "ChecklistSubmissionStatus" AS ENUM ('SUBMITTED', 'REVIEWED');

-- CreateTable
CREATE TABLE "checklist_submissions" (
    "id" TEXT NOT NULL,
    "checklistTemplateId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "status" "ChecklistSubmissionStatus" NOT NULL DEFAULT 'SUBMITTED',
    "visitNotes" TEXT,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "checklist_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "checklist_submission_answers" (
    "id" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "value" JSONB,
    "comment" TEXT,
    "images" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "checklist_submission_answers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_checklist_submissions_org" ON "checklist_submissions"("organizationId");

-- CreateIndex
CREATE INDEX "idx_checklist_submissions_patient" ON "checklist_submissions"("patientId");

-- CreateIndex
CREATE INDEX "idx_checklist_submissions_caregiver" ON "checklist_submissions"("userId");

-- CreateIndex
CREATE INDEX "idx_checklist_submissions_template" ON "checklist_submissions"("checklistTemplateId");

-- CreateIndex
CREATE INDEX "idx_submission_answers_submission" ON "checklist_submission_answers"("submissionId");

-- CreateIndex
CREATE UNIQUE INDEX "unique_answer_per_question" ON "checklist_submission_answers"("submissionId", "questionId");

-- AddForeignKey
ALTER TABLE "checklist_submissions" ADD CONSTRAINT "checklist_submissions_checklistTemplateId_fkey" FOREIGN KEY ("checklistTemplateId") REFERENCES "checklist_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checklist_submissions" ADD CONSTRAINT "checklist_submissions_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checklist_submissions" ADD CONSTRAINT "checklist_submissions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checklist_submissions" ADD CONSTRAINT "checklist_submissions_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checklist_submission_answers" ADD CONSTRAINT "checklist_submission_answers_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "checklist_submissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checklist_submission_answers" ADD CONSTRAINT "checklist_submission_answers_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "checklist_template_questions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
