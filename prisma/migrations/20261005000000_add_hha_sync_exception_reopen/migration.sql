-- Who reopened a sync exception, and when (PREVENT-727).
--
-- Additive only. A reopen now keeps who closed the row and the note, so the
-- next admin can still read them; these two columns record the reopen itself.
-- reopened_by_user_id is NULL when a repeat in a later sync reopened the row.

ALTER TABLE "hha_sync_exceptions"
  ADD COLUMN "reopened_at" TIMESTAMPTZ(3),
  ADD COLUMN "reopened_by_user_id" TEXT;
