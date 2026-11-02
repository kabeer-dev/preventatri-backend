-- Invitation tracking on users (PREVENT-751).
--
-- Additive only. The roster must not read secret_keys (auth material), so who
-- was invited, by whom and when it was accepted get plain columns.

ALTER TABLE "users"
  ADD COLUMN "invitation_sent_at" TIMESTAMP(3),
  ADD COLUMN "invited_by_user_id" TEXT,
  ADD COLUMN "invitation_accepted_at" TIMESTAMP(3);

-- An invitation still outstanding keeps its send time inside secret_keys.
UPDATE "users"
SET "invitation_sent_at" =
  ("secret_keys"->>'invitationSentAt')::timestamptz AT TIME ZONE 'UTC'
WHERE "secret_keys"->>'invitationSentAt' ~ '^\d{4}-\d{2}-\d{2}T';
