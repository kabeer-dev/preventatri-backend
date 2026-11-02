-- Update default to UPCOMING to match Prisma schema
ALTER TABLE "checklist_submissions" ALTER COLUMN "status" SET DEFAULT 'UPCOMING'::"ChecklistSubmissionStatus";
