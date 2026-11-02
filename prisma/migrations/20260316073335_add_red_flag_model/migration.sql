-- CreateEnum
CREATE TYPE "RedFlagReason" AS ENUM ('fall_or_injury', 'sudden_health_decline', 'unresponsive', 'severe_pain', 'difficulty_breathing', 'medication_issue', 'other');

-- CreateTable
CREATE TABLE "red_flags" (
    "id" TEXT NOT NULL,
    "reason" "RedFlagReason" NOT NULL,
    "description" TEXT NOT NULL,
    "images" JSONB NOT NULL DEFAULT '[]',
    "audio_note" JSONB,
    "patientId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "submitted_by" TEXT NOT NULL,
    "deleted_at" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "red_flags_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_red_flags_org" ON "red_flags"("organizationId");

-- CreateIndex
CREATE INDEX "idx_red_flags_submitter" ON "red_flags"("submitted_by");

-- CreateIndex
CREATE INDEX "idx_red_flags_patient" ON "red_flags"("patientId");

-- AddForeignKey
ALTER TABLE "red_flags" ADD CONSTRAINT "red_flags_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "red_flags" ADD CONSTRAINT "red_flags_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "red_flags" ADD CONSTRAINT "red_flags_submitted_by_fkey" FOREIGN KEY ("submitted_by") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
