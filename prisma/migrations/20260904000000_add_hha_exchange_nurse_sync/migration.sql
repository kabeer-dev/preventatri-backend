-- HHAeXchange one-way nurse import.
--
-- HHAeXchange has no nurse change feed. GetNurses is a thin roster (id, name,
-- offices, Active) and every nurse ALSO appears in GetCaregiverChangesV4 under
-- the same number, which is where the address, email, phone and licence come
-- from. So hha_nurse_id below holds the HHAeXchange NurseID, and that value is
-- the CaregiverID of the same person in the caregiver feed.
--
-- Hand-authored, same reason as 20260901000100_add_hha_exchange_caregiver_sync:
-- DATABASE_URL points at a Supabase transaction pooler with no
-- directUrl/shadowDatabaseUrl, so `prisma migrate dev` cannot run here. The
-- CHECK constraint below is not expressible in the Prisma DSL anyway.

-- ── 1. Nurse source enum ────────────────────────────────────────────────────
CREATE TYPE "NurseSource" AS ENUM ('MANUAL', 'HHA_EXCHANGE');

-- ── 2. Licence columns become nullable ──────────────────────────────────────
-- HHAeXchange publishes ProfessionalLicensenumber only sometimes and a licence
-- expiration date never, so an imported nurse cannot satisfy NOT NULL on
-- either. The invite form still requires both on a manually created nurse;
-- on an imported one the expiration date is PreventaTri-owned and an admin
-- fills it in during review. Existing rows are untouched.
ALTER TABLE "nurse_profiles"
  ALTER COLUMN "licenseNumber"         DROP NOT NULL,
  ALTER COLUMN "licenseExpirationDate" DROP NOT NULL;

-- ── 3. HHAeXchange bookkeeping columns ──────────────────────────────────────
-- The NOT NULL DEFAULT 'MANUAL' is the backfill: every pre-existing nurse was
-- invited by hand in PreventaTri, which is exactly what the default records.
--
-- hha_modified_date is the caregiver feed's ModifiedDate for the record, kept
-- for display like on caregiver_profiles; hha_sync_hash is what gates writes.
ALTER TABLE "nurse_profiles"
  ADD COLUMN "source"             "NurseSource" NOT NULL DEFAULT 'MANUAL',
  ADD COLUMN "hha_nurse_id"       VARCHAR(32),
  ADD COLUMN "hha_sync_hash"      VARCHAR(64),
  ADD COLUMN "hha_last_synced_at" TIMESTAMP(3),
  ADD COLUMN "hha_modified_date"  TIMESTAMP(3);

-- ── 4. Identity index ───────────────────────────────────────────────────────
-- hha_nurse_id is the ONLY key sync matches on (never name, never email).
--
-- Like unique_hha_caregiver_per_org and UNLIKE the house convention in
-- unique_nurse_profile_per_org (which filters deleted_at IS NULL), this index
-- deliberately SPANS soft-deleted rows. If it excluded archived rows, archiving
-- a nurse still active in HHAeXchange would make the next nightly sync insert a
-- duplicate, and the admin's archive decision would silently undo itself every
-- night. Spanning soft-deletes means the reconciler finds the archived row and
-- updates it in place, leaving deleted_at untouched.
--
-- Declared as @@unique in schema.prisma (not a partial index) so Prisma exposes
-- the compound-unique input. Postgres treats NULLs as distinct, so the many
-- MANUAL rows -- all NULL here -- never collide.
CREATE UNIQUE INDEX "unique_hha_nurse_per_org"
  ON "nurse_profiles" ("organizationId", "hha_nurse_id");

-- ── 5. Lookup index ─────────────────────────────────────────────────────────
CREATE INDEX "idx_nurse_profiles_org_source"
  ON "nurse_profiles" ("organizationId", "source");

-- ── 6. Identity integrity ───────────────────────────────────────────────────
-- A MANUAL nurse never carries an HHA id; an HHA_EXCHANGE nurse always does.
-- NOT VALID first, then VALIDATE, per the house pattern in
-- 20260709000000_add_notification_document_routing.
ALTER TABLE "nurse_profiles"
  ADD CONSTRAINT "nurse_profiles_hha_identity_check"
  CHECK (
    ("source" = 'MANUAL'       AND "hha_nurse_id" IS NULL) OR
    ("source" = 'HHA_EXCHANGE' AND "hha_nurse_id" IS NOT NULL)
  ) NOT VALID;

ALTER TABLE "nurse_profiles" VALIDATE CONSTRAINT "nurse_profiles_hha_identity_check";
