-- Default to SYSTEM so a row without an explicit actor stays consistent with the
-- performer CHECK constraint below.
ALTER TABLE "notifications" ALTER COLUMN "performer_type" SET DEFAULT 'SYSTEM';

-- Enforce the performer invariant at the DB level (not just in the service):
-- USER performers must have a performed_by; SYSTEM performers must not.
ALTER TABLE "notifications"
  ADD CONSTRAINT "notifications_performer_consistency_check"
  CHECK (
    (performer_type = 'USER' AND performed_by IS NOT NULL) OR
    (performer_type = 'SYSTEM' AND performed_by IS NULL)
  );

-- Recency feed: list a recipient's notifications ordered by created_at DESC.
CREATE INDEX "notifications_recipient_id_organization_id_created_at_idx"
  ON "notifications"("recipient_id", "organization_id", "created_at" DESC);
