-- CreateEnum
CREATE TYPE "NotificationDocumentType" AS ENUM ('FLAG', 'FOLLOWUPTASK', 'SUPERVISORYVISIT');

-- Routing target for the frontend: document_type picks the details page and
-- document_id is that record's id. No FK — the targets live in different tables
-- (submission_flags, follow_up_tasks, supervisory_visits) and deleting a target
-- must not delete the notification history. Both null when the notification has
-- no navigation target (also the value for all pre-existing rows).
ALTER TABLE "notifications" ADD COLUMN "document_type" "NotificationDocumentType";
ALTER TABLE "notifications" ADD COLUMN "document_id" TEXT;

-- Keep the routing pair consistent: either both set or both null. Added as
-- NOT VALID so it does not force a full-table scan that blocks writes on deploy;
-- all existing rows have both columns NULL (trivially valid) so the follow-up
-- VALIDATE only takes a lighter lock.
ALTER TABLE "notifications"
  ADD CONSTRAINT "notifications_document_consistency_check"
  CHECK (
    (document_type IS NOT NULL AND document_id IS NOT NULL) OR
    (document_type IS NULL AND document_id IS NULL)
  ) NOT VALID;

ALTER TABLE "notifications"
  VALIDATE CONSTRAINT "notifications_document_consistency_check";
