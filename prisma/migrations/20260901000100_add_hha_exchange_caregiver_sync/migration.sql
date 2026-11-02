-- HHAeXchange one-way caregiver import.
--
-- Hand-authored, same reason as 20260828000000_add_hha_exchange_patient_sync:
-- DATABASE_URL points at a Supabase transaction pooler with no
-- directUrl/shadowDatabaseUrl, so `prisma migrate dev` cannot run here. The
-- CHECK constraint below is not expressible in the Prisma DSL anyway.
--
-- The six-value CaregiverStatus enum lands in the migration immediately before
-- this one, because ALTER TYPE ... ADD VALUE is not usable in the transaction
-- that adds it.

-- ── 1. Caregiver source enum ────────────────────────────────────────────────
CREATE TYPE "CaregiverSource" AS ENUM ('MANUAL', 'HHA_EXCHANGE');

-- ── 2. Caregiver address needs a state ──────────────────────────────────────
-- Caregiver address lives on `users` (CaregiverProfile is a User satellite),
-- and users already carries address / city / zip_code but never had a state.
-- HHAeXchange's caregiver Address block supplies one, and Patient already
-- stores state, so this closes the gap rather than inventing a shape.
ALTER TABLE "users" ADD COLUMN "state" VARCHAR(50);

-- ── 3. HHAeXchange bookkeeping columns ──────────────────────────────────────
-- The NOT NULL DEFAULT 'MANUAL' is the backfill: every pre-existing caregiver
-- was invited by hand in PreventaTri, which is exactly what the default records.
--
-- termination_date is a real PreventaTri field (HHAeXchange TerminatedDate),
-- not bookkeeping -- it sits beside the existing start_date/startDate column.
ALTER TABLE "caregiver_profiles"
  ADD COLUMN "termination_date"   TIMESTAMP(3),
  ADD COLUMN "source"             "CaregiverSource" NOT NULL DEFAULT 'MANUAL',
  ADD COLUMN "hha_caregiver_id"   VARCHAR(32),
  ADD COLUMN "hha_sync_hash"      VARCHAR(64),
  ADD COLUMN "hha_last_synced_at" TIMESTAMP(3),
  ADD COLUMN "hha_modified_date"  TIMESTAMP(3);

-- ── 4. Identity index ───────────────────────────────────────────────────────
-- hha_caregiver_id is the ONLY key sync matches on (never name, never email).
--
-- Like unique_hha_patient_per_org and UNLIKE the house convention in
-- unique_caregiver_profile_per_org (which filters deleted_at IS NULL), this
-- index deliberately SPANS soft-deleted rows. If it excluded archived rows,
-- archiving a caregiver still active in HHAeXchange would make the next nightly
-- sync insert a duplicate, and the admin's archive decision would silently undo
-- itself every night. Spanning soft-deletes means the reconciler finds the
-- archived row and updates it in place, leaving deleted_at untouched.
--
-- Declared as @@unique in schema.prisma (not a partial index) so Prisma exposes
-- the compound-unique input. Postgres treats NULLs as distinct, so the many
-- MANUAL rows -- all NULL here -- never collide.
CREATE UNIQUE INDEX "unique_hha_caregiver_per_org"
  ON "caregiver_profiles" ("organizationId", "hha_caregiver_id");

-- ── 5. Lookup index ─────────────────────────────────────────────────────────
CREATE INDEX "idx_caregiver_profiles_org_source"
  ON "caregiver_profiles" ("organizationId", "source");

-- ── 6. Identity integrity ───────────────────────────────────────────────────
-- A MANUAL caregiver never carries an HHA id; an HHA_EXCHANGE caregiver always
-- does. NOT VALID first, then VALIDATE, per the house pattern in
-- 20260709000000_add_notification_document_routing.
ALTER TABLE "caregiver_profiles"
  ADD CONSTRAINT "caregiver_profiles_hha_identity_check"
  CHECK (
    ("source" = 'MANUAL'       AND "hha_caregiver_id" IS NULL) OR
    ("source" = 'HHA_EXCHANGE' AND "hha_caregiver_id" IS NOT NULL)
  ) NOT VALID;

ALTER TABLE "caregiver_profiles" VALIDATE CONSTRAINT "caregiver_profiles_hha_identity_check";
