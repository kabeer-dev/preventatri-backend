-- Audit actions for the life of a flag escalation (started, assigned, moved to
-- the next level).
--
-- Additive only.

ALTER TYPE "AuditAction" ADD VALUE 'ESCALATION_STARTED';
ALTER TYPE "AuditAction" ADD VALUE 'ESCALATION_ASSIGNED';
ALTER TYPE "AuditAction" ADD VALUE 'ESCALATED';
