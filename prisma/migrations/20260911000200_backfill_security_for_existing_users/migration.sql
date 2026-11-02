-- Hand-authored, same reason as 20260911000100_add_securities: DATABASE_URL
-- points at a Supabase transaction pooler with no directUrl/shadowDatabaseUrl
-- wired into prisma.config.ts, so `prisma migrate dev` cannot compute a
-- shadow-database diff here.
--
-- Data backfill: every user created before the Security table existed has no
-- row there. Give each of them one, seeded with the OTP behavior the app used
-- before this table existed (the old ENABLED_OTPs constant: email required,
-- phone not) so existing users see no change in behavior. New users going
-- forward get {email:false,phone:false} via securityServices.createSecuritySettings.
INSERT INTO "securities" ("id", "user_id", "otp_notifications", "created_at", "updated_at")
SELECT gen_random_uuid(), "id", '{"email":true,"phone":false}'::jsonb, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "users" u
WHERE NOT EXISTS (
  SELECT 1 FROM "securities" s WHERE s."user_id" = u."id"
);
