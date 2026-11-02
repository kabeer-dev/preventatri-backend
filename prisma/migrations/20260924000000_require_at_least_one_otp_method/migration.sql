-- Require at least one OTP method (email or phone) to be enabled on every
-- Security row. Prisma cannot express CHECK constraints in schema.prisma, so
-- this is hand-authored.

-- Backfill rows that would violate the constraint (both false, or keys
-- missing) by turning email on, matching DEFAULT_OTP_METHODS. phone is left
-- as it was.
UPDATE "securities"
SET "otp_methods" = "otp_methods" || '{"email": true}'::jsonb
WHERE NOT (
  "otp_methods" @> '{"email": true}'::jsonb OR
  "otp_methods" @> '{"phone": true}'::jsonb
);

-- The old default ({"email":false,"phone":false}) would violate the new
-- constraint, so align it with DEFAULT_OTP_METHODS.
ALTER TABLE "securities"
  ALTER COLUMN "otp_methods" SET DEFAULT '{"email":true,"phone":false}'::jsonb;

-- @> (containment) evaluates to false rather than NULL when a key is
-- missing, so a row without either key is rejected instead of slipping past
-- the CHECK.
ALTER TABLE "securities"
  ADD CONSTRAINT "securities_otp_methods_at_least_one_check"
  CHECK (
    "otp_methods" @> '{"email": true}'::jsonb OR
    "otp_methods" @> '{"phone": true}'::jsonb
  );
