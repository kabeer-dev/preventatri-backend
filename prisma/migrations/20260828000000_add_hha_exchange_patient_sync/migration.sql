-- HHAeXchange one-way patient import.
--
-- Hand-authored rather than generated: DATABASE_URL points at a Supabase
-- transaction pooler with no directUrl/shadowDatabaseUrl, so `prisma migrate
-- dev` cannot run here. The partial unique index and the CHECK constraint
-- below are not expressible in the Prisma schema DSL anyway — same reason
-- 20260115130200_add_partial_unique_indexes is hand-written.

-- ── 1. Patient source enum ──────────────────────────────────────────────────
CREATE TYPE "PatientSource" AS ENUM ('MANUAL', 'HHA_EXCHANGE');

-- ── 2. countyId becomes optional ────────────────────────────────────────────
-- HHAeXchange's patient change feed carries no county at all, and PreventaTri
-- counties cannot be created on the fly (County.regionId is required, and
-- counties are only ever created through Region create/update). An HHA patient
-- whose county name does not resolve is imported with a NULL county and shown
-- on the admin worklist (see idx_patients_unresolved_county below).
ALTER TABLE "patients" ALTER COLUMN "countyId" DROP NOT NULL;

-- ── 3. HHAeXchange bookkeeping columns ──────────────────────────────────────
-- The NOT NULL DEFAULT 'MANUAL' is the backfill: every pre-existing patient was
-- created by hand in PreventaTri, which is exactly what the default records.
ALTER TABLE "patients"
  ADD COLUMN "source"             "PatientSource" NOT NULL DEFAULT 'MANUAL',
  ADD COLUMN "hha_patient_id"     VARCHAR(32),
  ADD COLUMN "hha_sync_hash"      VARCHAR(64),
  ADD COLUMN "hha_last_synced_at" TIMESTAMP(3);

-- ── 4. Identity index ───────────────────────────────────────────────────────
-- hha_patient_id is the ONLY key sync matches on (never name, never email).
--
-- This index deliberately SPANS soft-deleted rows, unlike the house convention
-- in unique_caregiver_profile_per_org (which filters deleted_at IS NULL). If it
-- excluded archived rows, archiving an HHA patient who is still active in
-- HHAeXchange would make the very next nightly sync insert a duplicate, and the
-- admin's archive decision would silently undo itself every night. Spanning
-- soft-deletes means the upsert finds the archived row and updates it in place,
-- leaving deleted_at untouched.
-- Declared as @@unique in schema.prisma (not a partial index) so Prisma exposes
-- the compound-unique input that upsert requires. Postgres treats NULLs as
-- distinct, so the many MANUAL rows -- all NULL here -- never collide.
CREATE UNIQUE INDEX "unique_hha_patient_per_org"
  ON "patients" ("organizationId", "hha_patient_id");

-- ── 5. Lookup indexes ───────────────────────────────────────────────────────
CREATE INDEX "idx_patients_org_source" ON "patients" ("organizationId", "source");

-- Admin worklist: HHA patients whose county name did not resolve. These rows are
-- invisible to every region-scoped nurse query (which filters on the county
-- relation), so they need to be findable and fixable.
CREATE INDEX "idx_patients_unresolved_county"
  ON "patients" ("organizationId")
  WHERE "countyId" IS NULL AND "deleted_at" IS NULL;

-- ── 6. Identity integrity ───────────────────────────────────────────────────
-- A MANUAL patient never carries an HHA id; an HHA_EXCHANGE patient always does.
-- NOT VALID first, then VALIDATE, per the house pattern in
-- 20260709000000_add_notification_document_routing.
ALTER TABLE "patients"
  ADD CONSTRAINT "patients_hha_identity_check"
  CHECK (
    ("source" = 'MANUAL'       AND "hha_patient_id" IS NULL) OR
    ("source" = 'HHA_EXCHANGE' AND "hha_patient_id" IS NOT NULL)
  ) NOT VALID;

ALTER TABLE "patients" VALIDATE CONSTRAINT "patients_hha_identity_check";
