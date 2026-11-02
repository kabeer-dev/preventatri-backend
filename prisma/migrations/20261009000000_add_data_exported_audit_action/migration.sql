-- Audit action for client-side data exports (reports, and future downloads).
--
-- Additive only.

ALTER TYPE "AuditAction" ADD VALUE 'DATA_EXPORTED';
