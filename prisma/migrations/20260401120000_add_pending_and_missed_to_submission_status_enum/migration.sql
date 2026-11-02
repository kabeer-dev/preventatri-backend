-- Add missing PENDING and MISSED values to ChecklistSubmissionStatus enum
ALTER TYPE "ChecklistSubmissionStatus" ADD VALUE IF NOT EXISTS 'PENDING';
ALTER TYPE "ChecklistSubmissionStatus" ADD VALUE IF NOT EXISTS 'MISSED';
