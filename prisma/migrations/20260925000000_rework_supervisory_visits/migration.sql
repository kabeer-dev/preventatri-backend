-- Supervisory visit rework: role-agnostic assignee (UserOrganization),
-- caregivers present, visit type, scheduled window, reminders, filing /
-- review / cancellation and a per-visit event log. Additive: the legacy
-- case_manager_profile_id, due_date, visit_instructions and flag_type columns
-- stay (nullable, no longer written) for a later cleanup.

-- 1. Relax the legacy NOT NULLs
ALTER TABLE "supervisory_visits" ALTER COLUMN "case_manager_profile_id" DROP NOT NULL;
ALTER TABLE "supervisory_visits" ALTER COLUMN "due_date" DROP NOT NULL;

-- 2. New columns (NOT NULL is applied after the backfill below)
ALTER TABLE "supervisory_visits"
    ADD COLUMN "assignee_user_organization_id" TEXT,
    ADD COLUMN "submission_flag_id" TEXT,
    ADD COLUMN "visit_type" TEXT NOT NULL DEFAULT 'ROUTINE',
    ADD COLUMN "visit_type_other" VARCHAR(200),
    ADD COLUMN "description" TEXT,
    ADD COLUMN "scheduled_start_at" TIMESTAMPTZ(3),
    ADD COLUMN "scheduled_end_at" TIMESTAMPTZ(3),
    ADD COLUMN "sent_reminder_offsets" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    ADD COLUMN "completion_outcome" TEXT,
    ADD COLUMN "completion_files" JSONB NOT NULL DEFAULT '[]',
    ADD COLUMN "overdue_at" TIMESTAMPTZ(3),
    ADD COLUMN "reviewed_at" TIMESTAMPTZ(3),
    ADD COLUMN "reviewed_by" TEXT,
    ADD COLUMN "review_note" TEXT,
    ADD COLUMN "cancel_reason" TEXT,
    ADD COLUMN "cancelled_at" TIMESTAMPTZ(3),
    ADD COLUMN "cancelled_by" TEXT;

ALTER TABLE "supervisory_visits" ALTER COLUMN "status" SET DEFAULT 'SCHEDULED';

-- 3a. Assignee: the legacy case manager's membership in the visit's organization
UPDATE "supervisory_visits" sv
SET "assignee_user_organization_id" = uo."id"
FROM "case_manager_profiles" cmp
JOIN "user_organizations" uo
  ON uo."userId" = cmp."userId"
 AND uo."organizationId" = cmp."organizationId"
WHERE cmp."id" = sv."case_manager_profile_id"
  AND sv."assignee_user_organization_id" IS NULL;

-- 3b. Fallback for a case manager without a membership row: the org's oldest
--     active admin (same rule as the created_by backfill).
UPDATE "supervisory_visits" sv
SET "assignee_user_organization_id" = (
    SELECT uo."id"
    FROM "user_organizations" uo
    WHERE uo."organizationId" = sv."organization_id"
      AND uo."role" = 'admin'
      AND uo."isActive" = TRUE
      AND uo."deleted_at" IS NULL
    ORDER BY uo."createdAt" ASC
    LIMIT 1
)
WHERE "assignee_user_organization_id" IS NULL;

-- 3c. Scheduled window: 09:00-10:00 Eastern on the legacy calendar date
UPDATE "supervisory_visits"
SET "scheduled_start_at" = ("due_date"::timestamp + TIME '09:00') AT TIME ZONE 'America/New_York',
    "scheduled_end_at"   = ("due_date"::timestamp + TIME '10:00') AT TIME ZONE 'America/New_York'
WHERE "scheduled_start_at" IS NULL
  AND "due_date" IS NOT NULL;

-- 3d. Description and visit type from the legacy columns
UPDATE "supervisory_visits"
SET "description" = "visit_instructions"
WHERE "description" IS NULL
  AND NULLIF(TRIM("visit_instructions"), '') IS NOT NULL;

UPDATE "supervisory_visits"
SET "visit_type" = 'TRIGGERED'
WHERE "flag_type" IN (0, 1);

-- 3e. Status: PENDING -> SCHEDULED, COMPLETED -> APPROVED (reviewer unknown)
UPDATE "supervisory_visits" SET "status" = 'SCHEDULED' WHERE "status" = 'PENDING';

UPDATE "supervisory_visits"
SET "status" = 'APPROVED',
    "reviewed_at" = COALESCE("completed_at", "updated_at")
WHERE "status" = 'COMPLETED';

-- 4. Enforce NOT NULL after the backfill
ALTER TABLE "supervisory_visits" ALTER COLUMN "assignee_user_organization_id" SET NOT NULL;
ALTER TABLE "supervisory_visits" ALTER COLUMN "scheduled_start_at" SET NOT NULL;
ALTER TABLE "supervisory_visits" ALTER COLUMN "scheduled_end_at" SET NOT NULL;

-- 5. Foreign keys + indexes
ALTER TABLE "supervisory_visits" ADD CONSTRAINT "supervisory_visits_assignee_user_organization_id_fkey"
    FOREIGN KEY ("assignee_user_organization_id") REFERENCES "user_organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "supervisory_visits" ADD CONSTRAINT "supervisory_visits_submission_flag_id_fkey"
    FOREIGN KEY ("submission_flag_id") REFERENCES "submission_flags"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "supervisory_visits" ADD CONSTRAINT "supervisory_visits_reviewed_by_fkey"
    FOREIGN KEY ("reviewed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "supervisory_visits" ADD CONSTRAINT "supervisory_visits_cancelled_by_fkey"
    FOREIGN KEY ("cancelled_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "idx_supervisory_visits_org_status_start" ON "supervisory_visits"("organization_id", "status", "scheduled_start_at");
CREATE INDEX "idx_supervisory_visits_assignee_status" ON "supervisory_visits"("assignee_user_organization_id", "status");
CREATE INDEX "idx_supervisory_visits_submission_flag" ON "supervisory_visits"("submission_flag_id");

-- 6. Caregivers present
CREATE TABLE "supervisory_visit_caregivers" (
    "visit_id" UUID NOT NULL,
    "user_organization_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supervisory_visit_caregivers_pkey" PRIMARY KEY ("visit_id", "user_organization_id")
);

CREATE INDEX "idx_supervisory_visit_caregivers_user_org" ON "supervisory_visit_caregivers"("user_organization_id");

ALTER TABLE "supervisory_visit_caregivers" ADD CONSTRAINT "supervisory_visit_caregivers_visit_id_fkey"
    FOREIGN KEY ("visit_id") REFERENCES "supervisory_visits"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "supervisory_visit_caregivers" ADD CONSTRAINT "supervisory_visit_caregivers_user_organization_id_fkey"
    FOREIGN KEY ("user_organization_id") REFERENCES "user_organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 7. Event log
CREATE TABLE "supervisory_visit_events" (
    "id" TEXT NOT NULL,
    "visit_id" UUID NOT NULL,
    "organization_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "actor_type" TEXT NOT NULL,
    "actor_user_id" TEXT,
    "from_status" TEXT,
    "to_status" TEXT,
    "from_assignee_user_organization_id" TEXT,
    "to_assignee_user_organization_id" TEXT,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supervisory_visit_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "idx_supervisory_visit_events_visit_created" ON "supervisory_visit_events"("visit_id", "created_at");

ALTER TABLE "supervisory_visit_events" ADD CONSTRAINT "supervisory_visit_events_visit_id_fkey"
    FOREIGN KEY ("visit_id") REFERENCES "supervisory_visits"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "supervisory_visit_events" ADD CONSTRAINT "supervisory_visit_events_actor_user_id_fkey"
    FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "supervisory_visit_events" ADD CONSTRAINT "supervisory_visit_events_from_assignee_user_organization_id_fkey"
    FOREIGN KEY ("from_assignee_user_organization_id") REFERENCES "user_organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "supervisory_visit_events" ADD CONSTRAINT "supervisory_visit_events_to_assignee_user_organization_id_fkey"
    FOREIGN KEY ("to_assignee_user_organization_id") REFERENCES "user_organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 8. Follow-up tasks spawned from a visit
ALTER TABLE "follow_up_tasks" ADD COLUMN "supervisory_visit_id" UUID;

ALTER TABLE "follow_up_tasks" ADD CONSTRAINT "follow_up_tasks_supervisory_visit_id_fkey"
    FOREIGN KEY ("supervisory_visit_id") REFERENCES "supervisory_visits"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "idx_follow_up_tasks_supervisory_visit" ON "follow_up_tasks"("supervisory_visit_id");

-- 9. Seed history for existing visits so the History panel is never empty
INSERT INTO "supervisory_visit_events"
    ("id", "visit_id", "organization_id", "type", "actor_type", "actor_user_id", "to_status", "to_assignee_user_organization_id", "created_at")
SELECT gen_random_uuid()::text, sv."id", sv."organization_id", 'CREATED', 'USER', sv."created_by", 'SCHEDULED', sv."assignee_user_organization_id", sv."created_at"
FROM "supervisory_visits" sv;

INSERT INTO "supervisory_visit_events"
    ("id", "visit_id", "organization_id", "type", "actor_type", "actor_user_id", "from_status", "to_status", "created_at")
SELECT gen_random_uuid()::text, sv."id", sv."organization_id", 'FILED', 'USER', sv."completed_by", 'SCHEDULED', 'UNDER_REVIEW', COALESCE(sv."completed_at", sv."updated_at")
FROM "supervisory_visits" sv
WHERE sv."status" = 'APPROVED';

INSERT INTO "supervisory_visit_events"
    ("id", "visit_id", "organization_id", "type", "actor_type", "from_status", "to_status", "payload", "created_at")
SELECT gen_random_uuid()::text, sv."id", sv."organization_id", 'APPROVED', 'SYSTEM', 'UNDER_REVIEW', 'APPROVED', '{"backfilled": true}', COALESCE(sv."completed_at", sv."updated_at")
FROM "supervisory_visits" sv
WHERE sv."status" = 'APPROVED';
