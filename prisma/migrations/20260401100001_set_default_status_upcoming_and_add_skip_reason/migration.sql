-- Add skip_reason column
ALTER TABLE "checklist_submissions" ADD COLUMN IF NOT EXISTS "skip_reason" TEXT;

-- Change default status from PENDING to UPCOMING
ALTER TABLE "checklist_submissions" ALTER COLUMN "status" SET DEFAULT 'UPCOMING';
