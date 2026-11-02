-- AlterEnum
ALTER TYPE "EscalationAction" ADD VALUE 'RESOLVED';

-- AlterEnum
ALTER TYPE "EscalationStatus" ADD VALUE 'RESOLVED';

-- CreateTable
CREATE TABLE "submission_flag_escalation_responses" (
    "id" TEXT NOT NULL,
    "escalation_id" TEXT NOT NULL,
    "submission_flag_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "actions" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "notes" TEXT,
    "has_follow_up" BOOLEAN NOT NULL DEFAULT false,
    "follow_up_date" TIMESTAMPTZ(3),
    "follow_up_description" TEXT,
    "has_supervisory_visit" BOOLEAN NOT NULL DEFAULT false,
    "supervisory_visit_date" TIMESTAMPTZ(3),
    "supervisory_instructions" TEXT,
    "submitted_by" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "submission_flag_escalation_responses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "submission_flag_escalation_responses_escalation_id_key" ON "submission_flag_escalation_responses"("escalation_id");

-- CreateIndex
CREATE UNIQUE INDEX "submission_flag_escalation_responses_submission_flag_id_key" ON "submission_flag_escalation_responses"("submission_flag_id");

-- CreateIndex
CREATE INDEX "idx_escalation_responses_org" ON "submission_flag_escalation_responses"("organization_id");

-- CreateIndex
CREATE INDEX "idx_escalation_responses_submitter" ON "submission_flag_escalation_responses"("submitted_by");

-- AddForeignKey
ALTER TABLE "submission_flag_escalation_responses" ADD CONSTRAINT "submission_flag_escalation_responses_escalation_id_fkey" FOREIGN KEY ("escalation_id") REFERENCES "submission_flag_escalations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submission_flag_escalation_responses" ADD CONSTRAINT "submission_flag_escalation_responses_submission_flag_id_fkey" FOREIGN KEY ("submission_flag_id") REFERENCES "submission_flags"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submission_flag_escalation_responses" ADD CONSTRAINT "submission_flag_escalation_responses_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submission_flag_escalation_responses" ADD CONSTRAINT "submission_flag_escalation_responses_submitted_by_fkey" FOREIGN KEY ("submitted_by") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
