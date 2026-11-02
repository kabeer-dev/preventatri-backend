-- An escalated flag can be accepted by its current assignee, which stops the
-- escalation. The escalation row reuses the existing ACKNOWLEDGED status; the
-- flag row and the audit log get their own values.
--
-- Additive only.

ALTER TYPE "FlagStatus" ADD VALUE 'ACCEPTED' AFTER 'PENDING';
ALTER TYPE "AuditAction" ADD VALUE 'ESCALATION_ACCEPTED';
