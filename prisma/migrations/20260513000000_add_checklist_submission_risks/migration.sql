-- CreateEnum
CREATE TYPE "ChecklistRiskFlag" AS ENUM ('GREEN', 'YELLOW', 'RED');

-- CreateEnum
CREATE TYPE "RiskCategory" AS ENUM ('LOW', 'MODERATE', 'HIGH');

-- CreateTable
CREATE TABLE "checklist_submission_risks" (
    "id" TEXT NOT NULL,
    "submission_id" TEXT NOT NULL,
    "flag" "ChecklistRiskFlag" NOT NULL,
    "risk_score" INTEGER NOT NULL,
    "risk_category" "RiskCategory" NOT NULL,
    "calculated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "checklist_submission_risks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "checklist_submission_risks_submission_id_key" ON "checklist_submission_risks"("submission_id");

-- AddForeignKey
ALTER TABLE "checklist_submission_risks" ADD CONSTRAINT "checklist_submission_risks_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "checklist_submissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
