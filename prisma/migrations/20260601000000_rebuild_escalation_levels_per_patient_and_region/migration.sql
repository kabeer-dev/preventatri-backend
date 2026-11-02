-- Create EscalationLevel, EscalationStatus, and EscalationAction enums, then
-- create the submission_flag_escalations and submission_flag_escalation_events
-- tables. The original migration assumed the enum already existed with old
-- values to rename, but no prior migration ever created it — so we create
-- everything fresh. Idempotent: all statements use IF NOT EXISTS / exception
-- guards so a partially-applied run can be re-executed safely.

DO $$ BEGIN
  CREATE TYPE "EscalationLevel" AS ENUM (
    'PATIENT_PRIMARY_NURSE',
    'REGION_PRIMARY_NURSE',
    'PATIENT_SECONDARY_NURSE',
    'REGION_SECONDARY_NURSE',
    'CASE_MANAGER',
    'ADMIN'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "EscalationStatus" AS ENUM (
    'ACTIVE',
    'ACKNOWLEDGED',
    'EXPIRED',
    'FAILED'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "EscalationAction" AS ENUM (
    'ASSIGNED',
    'ACKNOWLEDGED',
    'ESCALATED',
    'EXPIRED',
    'REASSIGNED'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "submission_flag_escalations" (
    "id"                  TEXT          NOT NULL,
    "submission_flag_id"  TEXT          NOT NULL,
    "patientId"           TEXT          NOT NULL,
    "organizationId"      TEXT          NOT NULL,
    "regionId"            TEXT          NOT NULL,
    "currentLevel"        "EscalationLevel" NOT NULL,
    "current_assignee_id" TEXT,
    "assigned_at"         TIMESTAMPTZ(3) NOT NULL,
    "expires_at"          TIMESTAMPTZ(3) NOT NULL,
    "status"              "EscalationStatus" NOT NULL DEFAULT 'ACTIVE',
    "acknowledged_at"     TIMESTAMPTZ(3),
    "acknowledged_by_id"  TEXT,
    "created_at"          TIMESTAMPTZ(3) NOT NULL DEFAULT NOW(),
    "updated_at"          TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "submission_flag_escalations_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
  ALTER TABLE "submission_flag_escalations"
    ADD CONSTRAINT "submission_flag_escalations_submission_flag_id_key"
    UNIQUE ("submission_flag_id");
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "submission_flag_escalations"
    ADD CONSTRAINT "submission_flag_escalations_submission_flag_id_fkey"
    FOREIGN KEY ("submission_flag_id") REFERENCES "submission_flags"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "submission_flag_escalations"
    ADD CONSTRAINT "submission_flag_escalations_patientId_fkey"
    FOREIGN KEY ("patientId") REFERENCES "patients"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "submission_flag_escalations"
    ADD CONSTRAINT "submission_flag_escalations_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "submission_flag_escalations"
    ADD CONSTRAINT "submission_flag_escalations_regionId_fkey"
    FOREIGN KEY ("regionId") REFERENCES "regions"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "submission_flag_escalations"
    ADD CONSTRAINT "submission_flag_escalations_current_assignee_id_fkey"
    FOREIGN KEY ("current_assignee_id") REFERENCES "user_organizations"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "submission_flag_escalations"
    ADD CONSTRAINT "submission_flag_escalations_acknowledged_by_id_fkey"
    FOREIGN KEY ("acknowledged_by_id") REFERENCES "user_organizations"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "submission_flag_escalations_status_expires_at_idx"
  ON "submission_flag_escalations"("status", "expires_at");

CREATE INDEX IF NOT EXISTS "submission_flag_escalations_current_assignee_id_status_idx"
  ON "submission_flag_escalations"("current_assignee_id", "status");

CREATE INDEX IF NOT EXISTS "submission_flag_escalations_organizationId_status_idx"
  ON "submission_flag_escalations"("organizationId", "status");

CREATE TABLE IF NOT EXISTS "submission_flag_escalation_events" (
    "id"            TEXT          NOT NULL,
    "escalation_id" TEXT          NOT NULL,
    "level"         "EscalationLevel" NOT NULL,
    "assigneeId"    TEXT,
    "assigned_at"   TIMESTAMPTZ(3) NOT NULL,
    "ended_at"      TIMESTAMPTZ(3),
    "action"        "EscalationAction" NOT NULL,
    "created_at"    TIMESTAMPTZ(3) NOT NULL DEFAULT NOW(),

    CONSTRAINT "submission_flag_escalation_events_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
  ALTER TABLE "submission_flag_escalation_events"
    ADD CONSTRAINT "submission_flag_escalation_events_escalation_id_fkey"
    FOREIGN KEY ("escalation_id") REFERENCES "submission_flag_escalations"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "submission_flag_escalation_events"
    ADD CONSTRAINT "submission_flag_escalation_events_assigneeId_fkey"
    FOREIGN KEY ("assigneeId") REFERENCES "user_organizations"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "submission_flag_escalation_events_escalation_id_assigned_at_idx"
  ON "submission_flag_escalation_events"("escalation_id", "assigned_at");
