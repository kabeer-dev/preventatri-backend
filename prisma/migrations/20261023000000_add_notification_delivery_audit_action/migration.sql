-- The delivery worker logs the SMS / email outcome of each alert notification.
--
-- Additive only.

ALTER TYPE "AuditAction" ADD VALUE 'NOTIFICATION_DELIVERY';
