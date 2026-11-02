-- HHAeXchange one-way coordinator import.
--
-- HHAeXchange calls the role a Coordinator; PreventaTri calls it a Case
-- Manager. Same person, different word -- so the columns below carry the wire
-- name (hha_coordinator_id) while everything a user ever sees says
-- "Case Manager".
--
-- Hand-authored, same reason as 20260901000100_add_hha_exchange_caregiver_sync:
-- DATABASE_URL points at a Supabase transaction pooler with no
-- directUrl/shadowDatabaseUrl, so `prisma migrate dev` cannot run here. The
-- CHECK constraint below is not expressible in the Prisma DSL anyway.

-- ── 1. Case manager source enum ─────────────────────────────────────────────
CREATE TYPE "CaseManagerSource" AS ENUM ('MANUAL', 'HHA_EXCHANGE');

-- ── 2. HHAeXchange bookkeeping columns ──────────────────────────────────────
-- The NOT NULL DEFAULT 'MANUAL' is the backfill: every pre-existing case
-- manager was invited by hand in PreventaTri, which is exactly what the default
-- records.
--
-- There is deliberately NO hha_modified_date, unlike caregiver_profiles.
-- GetCoordinators is a full roster read and its CoordinatorInfo record carries
-- no ModifiedDate at all -- there is no such operation as
-- GetCoordinatorChanges. hha_last_synced_at is the only "when" this integration
-- can show for a case manager.
--
-- No office column: nothing in PreventaTri reads or displays the coordinator's
-- office, unlike on caregivers where source and status are shown, so it is not
-- captured even though every CoordinatorInfo carries it.
ALTER TABLE "case_manager_profiles"
  ADD COLUMN "source"             "CaseManagerSource" NOT NULL DEFAULT 'MANUAL',
  ADD COLUMN "hha_coordinator_id" VARCHAR(32),
  ADD COLUMN "hha_sync_hash"      VARCHAR(64),
  ADD COLUMN "hha_last_synced_at" TIMESTAMP(3);

-- ── 3. Identity index ───────────────────────────────────────────────────────
-- hha_coordinator_id is the key sync matches on first. Email is only a fallback
-- for ADOPTING an existing unclaimed profile, never for re-identifying a
-- coordinator on a later run.
--
-- Like unique_hha_caregiver_per_org and unique_hha_patient_per_org, and UNLIKE
-- the house convention in unique_case_manager_profile_per_org (which filters
-- deleted_at IS NULL), this index deliberately SPANS soft-deleted rows. If it
-- excluded archived rows, archiving a case manager still active in HHAeXchange
-- would make the next nightly sync insert a duplicate, and the admin's archive
-- decision would silently undo itself every night. Spanning soft-deletes means
-- the reconciler finds the archived row and updates it in place, leaving
-- deleted_at untouched.
--
-- Declared as @@unique in schema.prisma (not a partial index) so Prisma exposes
-- the compound-unique input. Postgres treats NULLs as distinct, so the many
-- MANUAL rows -- all NULL here -- never collide.
CREATE UNIQUE INDEX "unique_hha_coordinator_per_org"
  ON "case_manager_profiles" ("organizationId", "hha_coordinator_id");

-- ── 4. Lookup index ─────────────────────────────────────────────────────────
CREATE INDEX "idx_case_manager_profiles_org_source"
  ON "case_manager_profiles" ("organizationId", "source");

-- ── 5. Identity integrity ───────────────────────────────────────────────────
-- A MANUAL case manager never carries an HHA id; an HHA_EXCHANGE case manager
-- always does. NOT VALID first, then VALIDATE, per the house pattern in
-- 20260709000000_add_notification_document_routing.
ALTER TABLE "case_manager_profiles"
  ADD CONSTRAINT "case_manager_profiles_hha_identity_check"
  CHECK (
    ("source" = 'MANUAL'       AND "hha_coordinator_id" IS NULL) OR
    ("source" = 'HHA_EXCHANGE' AND "hha_coordinator_id" IS NOT NULL)
  ) NOT VALID;

ALTER TABLE "case_manager_profiles" VALIDATE CONSTRAINT "case_manager_profiles_hha_identity_check";
