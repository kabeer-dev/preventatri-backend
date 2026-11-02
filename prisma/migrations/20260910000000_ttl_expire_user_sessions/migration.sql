-- Hand-authored, same reason as the other recent hand-authored migrations
-- (see e.g. 20260909000000_add_user_sessions): DATABASE_URL points at a
-- Supabase transaction pooler with no directUrl/shadowDatabaseUrl wired
-- into prisma.config.ts, so `prisma migrate dev` cannot compute a shadow-
-- database diff here. This mirrors exactly what `prisma migrate dev` would
-- generate for renaming UserSession.lastActiveAt to UserSession.expiresAt.

ALTER TABLE "user_sessions" RENAME COLUMN "last_active_at" TO "expires_at";
