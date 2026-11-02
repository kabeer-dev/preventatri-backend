-- Invitation lifecycle audit actions (PREVENT-751).
--
-- Additive only. Kept apart from the column migration: a new enum value cannot
-- be used in the transaction that adds it.

ALTER TYPE "AuditAction" ADD VALUE 'INVITE_RESENT';
ALTER TYPE "AuditAction" ADD VALUE 'INVITE_ACCEPTED';
ALTER TYPE "AuditAction" ADD VALUE 'INVITE_REVOKED';
