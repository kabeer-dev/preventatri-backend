-- Make submittedAt nullable so PENDING submissions can be created without a timestamp
ALTER TABLE "checklist_submissions" ALTER COLUMN "submittedAt" DROP NOT NULL;
ALTER TABLE "checklist_submissions" ALTER COLUMN "submittedAt" DROP DEFAULT;
