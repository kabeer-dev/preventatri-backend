-- The organization switcher remembers the chosen organization on the login
-- session. Empty means the person's main organization, so existing sessions
-- keep working unchanged.

ALTER TABLE "user_sessions"
  ADD COLUMN IF NOT EXISTS "active_organization_id" TEXT;
