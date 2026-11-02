-- HHAeXchange one-way visit / schedule import.
--
-- In HHAeXchange a SCHEDULE and a VISIT are the same record: GetScheduleInfo
-- takes a Visit ID and CreateSchedule answers with a VisitID. One row here
-- therefore carries both halves -- the planned window (scheduled_*) and what
-- actually happened (actual_* / evv_*) -- and the HHA Visits page shows them as
-- two sections of one detail.
--
-- The table is STANDALONE by design. It stores the HHAeXchange PatientID and
-- CaregiverID plus a name snapshot taken at sync time, and no foreign key into
-- patients or caregiver_profiles: the page is a read-only view of the agency's
-- schedule rather than a PreventaTri workflow, and a visit can legitimately
-- name a patient PreventaTri has not imported yet.
--
-- Hand-authored, same reason as 20260904000000_add_hha_exchange_nurse_sync:
-- DATABASE_URL points at a Supabase transaction pooler with no
-- directUrl/shadowDatabaseUrl, so `prisma migrate dev` cannot run here.

-- ── 1. Status enum ──────────────────────────────────────────────────────────
-- Derived by the visit mapper (see constants/hhaVisitsConstants.js). DELETED is
-- set only by the GetDeletedVisitsV2 pass and is never overwritten by a later
-- change-feed row.
CREATE TYPE "HhaVisitStatus" AS ENUM (
  'SCHEDULED',
  'IN_PROGRESS',
  'COMPLETED',
  'MISSED',
  'DELETED'
);

-- ── 2. Visit type enum ──────────────────────────────────────────────────────
-- How the visit was SCHEDULED, as opposed to what happened on it. These are the
-- four options HHAeXchange's own CreateSchedule form offers for VisitType.
--
-- The change feed types VisitType as s:string and documents no domain for it,
-- so the mapper resolves the word through HHAX_VISIT_TYPE_MAP and stores NULL
-- plus an UNMAPPED_VISIT_TYPE exception for anything outside this list. The
-- column is nullable for that reason as much as for a feed that omits it.
CREATE TYPE "HhaVisitType" AS ENUM (
  'DAILY_FIXED',
  'DAILY_VARIABLE',
  'WEEKLY_VARIABLE',
  'NO_SCHEDULE'
);

-- ── 3. Table ────────────────────────────────────────────────────────────────
-- No `source` column, unlike the other HHA resources: every row is
-- HHAeXchange's. hha_visit_id is VARCHAR because HHAeXchange types VisitID as
-- s:long, same as hha_patient_id on patients.
--
-- A missed or deleted visit is RECORDED (status + reason), never soft-deleted:
-- a cancelled visit that vanished would look like it was never scheduled.
-- deleted_at exists only to honour the house soft-delete convention and the
-- sync never sets it.
CREATE TABLE "hha_visits" (
  "id"                        TEXT             NOT NULL,
  "organizationId"            TEXT             NOT NULL,

  "hha_visit_id"              VARCHAR(32)      NOT NULL,
  "hha_patient_id"            VARCHAR(32),
  "hha_caregiver_id"          VARCHAR(32),

  "patient_first_name"        VARCHAR(100),
  "patient_last_name"         VARCHAR(100),
  "caregiver_first_name"      VARCHAR(100),
  "caregiver_last_name"       VARCHAR(100),

  "visit_date"                DATE             NOT NULL,
  "visit_type"                "HhaVisitType",
  "time_zone"                 VARCHAR(50),
  "status"                    "HhaVisitStatus" NOT NULL DEFAULT 'SCHEDULED',

  -- Schedule half: the planned window as UTC instants.
  "scheduled_start_at"        TIMESTAMP(3),
  "scheduled_end_at"          TIMESTAMP(3),
  "schedule_duration_minutes" INTEGER,

  -- Visit half: what the agency recorded, and the raw EVV clock-in/out. Kept
  -- apart because an agency edit moves the first and never the second.
  "actual_start_at"           TIMESTAMP(3),
  "actual_end_at"             TIMESTAMP(3),
  "evv_start_at"              TIMESTAMP(3),
  "evv_end_at"                TIMESTAMP(3),
  "clock_in_evv_type"         VARCHAR(50),
  "clock_out_evv_type"        VARCHAR(50),

  -- missed_reason_id is stored RAW beside the resolved text: the agency's
  -- reason master list (GetMissedVisitReasons) does not cover every id the
  -- feed actually uses, so keeping the id is what keeps an unresolved reason
  -- traceable back to the agency.
  "is_missed_visit"           BOOLEAN          NOT NULL DEFAULT FALSE,
  "missed_reason_id"          INTEGER,
  "missed_reason"             VARCHAR(255),
  "hha_deleted_at"            TIMESTAMP(3),
  "hha_deleted_reason"        VARCHAR(255),

  -- Sync bookkeeping. hha_modified_date is HHAeXchange's LastModifiedDate,
  -- kept for display; hha_sync_hash is what gates writes.
  "hha_modified_date"         TIMESTAMP(3),
  "hha_sync_hash"             VARCHAR(64),
  "hha_last_synced_at"        TIMESTAMP(3),

  "deleted_at"                TIMESTAMP(3),
  "createdAt"                 TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"                 TIMESTAMP(3)     NOT NULL,

  CONSTRAINT "hha_visits_pkey" PRIMARY KEY ("id")
);

-- ── 4. Organization ownership ───────────────────────────────────────────────
ALTER TABLE "hha_visits"
  ADD CONSTRAINT "hha_visits_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- ── 5. Identity index ───────────────────────────────────────────────────────
-- hha_visit_id is the ONLY key sync matches on. Like unique_hha_patient_per_org
-- this deliberately SPANS soft-deleted rows, so an archived row is updated in
-- place rather than re-inserted as a duplicate on the next nightly run.
CREATE UNIQUE INDEX "unique_hha_visit_per_org"
  ON "hha_visits" ("organizationId", "hha_visit_id");

-- ── 6. Lookup indexes ───────────────────────────────────────────────────────
-- The list endpoint sorts by visit day, filters by status and visit type, and a
-- later patient drill-down will look up by the HHAeXchange patient id.
CREATE INDEX "idx_hha_visits_org_visit_date"
  ON "hha_visits" ("organizationId", "visit_date");

CREATE INDEX "idx_hha_visits_org_status"
  ON "hha_visits" ("organizationId", "status");

CREATE INDEX "idx_hha_visits_org_visit_type"
  ON "hha_visits" ("organizationId", "visit_type");

CREATE INDEX "idx_hha_visits_org_patient"
  ON "hha_visits" ("organizationId", "hha_patient_id");
