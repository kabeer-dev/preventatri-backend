-- Add UPCOMING and SKIPPED values to ChecklistSubmissionStatus enum
ALTER TYPE "ChecklistSubmissionStatus" ADD VALUE IF NOT EXISTS 'UPCOMING';
ALTER TYPE "ChecklistSubmissionStatus" ADD VALUE IF NOT EXISTS 'SKIPPED';
