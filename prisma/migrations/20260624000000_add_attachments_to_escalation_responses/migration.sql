-- Add attachments (array of {url, key}) to escalation resolutions so an assignee
-- can attach supporting evidence files while resolving a raised flag.
ALTER TABLE "submission_flag_escalation_responses"
ADD COLUMN "attachments" JSONB NOT NULL DEFAULT '[]';
