-- Hand-authored, same reason as 20260911000100_add_securities: DATABASE_URL
-- points at a Supabase transaction pooler with no directUrl/shadowDatabaseUrl
-- wired into prisma.config.ts, so `prisma migrate dev` cannot compute a
-- shadow-database diff here.
--
-- Rename Security.otpNotifications -> Security.otpMethods (column
-- otp_notifications -> otp_methods). A rename preserves existing data, so no
-- backfill is needed on top of this.
ALTER TABLE "securities" RENAME COLUMN "otp_notifications" TO "otp_methods";
