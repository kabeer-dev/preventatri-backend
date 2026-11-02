-- Follow-up task rework: role-agnostic assignee (UserOrganization), title /
-- description / priority, due instant, overdue / cancelled statuses,
-- reminders, completion outcome + evidence, cancellation
-- and a per-task event log. Additive: the legacy case_manager_profile_id and
-- due_date columns stay (nullable, no longer written) for a later cleanup.

-- 1. Relax the legacy NOT NULLs
ALTER TABLE "follow_up_tasks" ALTER COLUMN "case_manager_profile_id" DROP NOT NULL;
ALTER TABLE "follow_up_tasks" ALTER COLUMN "due_date" DROP NOT NULL;

-- 2. New columns (NOT NULL is applied after the backfill below)
ALTER TABLE "follow_up_tasks"
    ADD COLUMN "assignee_user_organization_id" TEXT,
    ADD COLUMN "submission_flag_id" TEXT,
    ADD COLUMN "title" VARCHAR(200),
    ADD COLUMN "description" TEXT,
    ADD COLUMN "priority" TEXT NOT NULL DEFAULT 'NORMAL',
    ADD COLUMN "due_at" TIMESTAMPTZ(3),
    ADD COLUMN "sent_reminder_offsets" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    ADD COLUMN "completion_outcome" TEXT,
    ADD COLUMN "completion_files" JSONB NOT NULL DEFAULT '[]',
    ADD COLUMN "overdue_at" TIMESTAMPTZ(3),
    ADD COLUMN "cancel_reason" TEXT,
    ADD COLUMN "cancelled_at" TIMESTAMPTZ(3),
    ADD COLUMN "cancelled_by" TEXT;

-- 3a. Assignee: the legacy case manager's membership in the task's organization
UPDATE "follow_up_tasks" ft
SET "assignee_user_organization_id" = uo."id"
FROM "case_manager_profiles" cmp
JOIN "user_organizations" uo
  ON uo."userId" = cmp."userId"
 AND uo."organizationId" = cmp."organizationId"
WHERE cmp."id" = ft."case_manager_profile_id"
  AND ft."assignee_user_organization_id" IS NULL;

-- 3b. Fallback for a case manager without a membership row: the org's oldest
--     active admin (same rule as the created_by backfill).
UPDATE "follow_up_tasks" ft
SET "assignee_user_organization_id" = (
    SELECT uo."id"
    FROM "user_organizations" uo
    WHERE uo."organizationId" = ft."organization_id"
      AND uo."role" = 'admin'
      AND uo."isActive" = TRUE
      AND uo."deleted_at" IS NULL
    ORDER BY uo."createdAt" ASC
    LIMIT 1
)
WHERE "assignee_user_organization_id" IS NULL;

-- 3c. Due instant: 17:00 Eastern on the legacy calendar date
UPDATE "follow_up_tasks"
SET "due_at" = ("due_date"::timestamp + TIME '17:00') AT TIME ZONE 'America/New_York'
WHERE "due_at" IS NULL
  AND "due_date" IS NOT NULL;

-- 3d. Title: the instructions, else the template title, else a generic label
UPDATE "follow_up_tasks"
SET "title" = LEFT("visit_instructions", 200)
WHERE "title" IS NULL
  AND NULLIF(TRIM("visit_instructions"), '') IS NOT NULL;

UPDATE "follow_up_tasks" ft
SET "title" = LEFT(ct."title"::text, 200)
FROM "checklist_templates" ct
WHERE ct."id" = ft."checklist_template_id"
  AND ft."title" IS NULL;

UPDATE "follow_up_tasks"
SET "title" = 'Follow-up task'
WHERE "title" IS NULL;

-- 4. Enforce NOT NULL after the backfill
ALTER TABLE "follow_up_tasks" ALTER COLUMN "assignee_user_organization_id" SET NOT NULL;
ALTER TABLE "follow_up_tasks" ALTER COLUMN "due_at" SET NOT NULL;
ALTER TABLE "follow_up_tasks" ALTER COLUMN "title" SET NOT NULL;

-- 5. Title is now the required field; template-or-instructions no longer applies
ALTER TABLE "follow_up_tasks" DROP CONSTRAINT IF EXISTS "follow_up_tasks_template_or_instructions_chk";

-- 6. Foreign keys + indexes
ALTER TABLE "follow_up_tasks" ADD CONSTRAINT "follow_up_tasks_assignee_user_organization_id_fkey"
    FOREIGN KEY ("assignee_user_organization_id") REFERENCES "user_organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "follow_up_tasks" ADD CONSTRAINT "follow_up_tasks_submission_flag_id_fkey"
    FOREIGN KEY ("submission_flag_id") REFERENCES "submission_flags"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "follow_up_tasks" ADD CONSTRAINT "follow_up_tasks_cancelled_by_fkey"
    FOREIGN KEY ("cancelled_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "idx_follow_up_tasks_org_status_due" ON "follow_up_tasks"("organization_id", "status", "due_at");
CREATE INDEX "idx_follow_up_tasks_assignee_status" ON "follow_up_tasks"("assignee_user_organization_id", "status");
CREATE INDEX "idx_follow_up_tasks_submission_flag" ON "follow_up_tasks"("submission_flag_id");

-- 7. Event log
CREATE TABLE "follow_up_task_events" (
    "id" TEXT NOT NULL,
    "task_id" UUID NOT NULL,
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

    CONSTRAINT "follow_up_task_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "idx_follow_up_task_events_task_created" ON "follow_up_task_events"("task_id", "created_at");

ALTER TABLE "follow_up_task_events" ADD CONSTRAINT "follow_up_task_events_task_id_fkey"
    FOREIGN KEY ("task_id") REFERENCES "follow_up_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "follow_up_task_events" ADD CONSTRAINT "follow_up_task_events_actor_user_id_fkey"
    FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "follow_up_task_events" ADD CONSTRAINT "follow_up_task_events_from_assignee_user_organization_id_fkey"
    FOREIGN KEY ("from_assignee_user_organization_id") REFERENCES "user_organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "follow_up_task_events" ADD CONSTRAINT "follow_up_task_events_to_assignee_user_organization_id_fkey"
    FOREIGN KEY ("to_assignee_user_organization_id") REFERENCES "user_organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 8. Seed history for existing tasks so the History panel is never empty
INSERT INTO "follow_up_task_events"
    ("id", "task_id", "organization_id", "type", "actor_type", "actor_user_id", "to_status", "to_assignee_user_organization_id", "created_at")
SELECT gen_random_uuid()::text, ft."id", ft."organization_id", 'CREATED', 'USER', ft."created_by", 'PENDING', ft."assignee_user_organization_id", ft."created_at"
FROM "follow_up_tasks" ft;

INSERT INTO "follow_up_task_events"
    ("id", "task_id", "organization_id", "type", "actor_type", "actor_user_id", "from_status", "to_status", "created_at")
SELECT gen_random_uuid()::text, ft."id", ft."organization_id", 'COMPLETED', 'USER', ft."completed_by", 'PENDING', 'COMPLETED', COALESCE(ft."completed_at", ft."updated_at")
FROM "follow_up_tasks" ft
WHERE ft."status" = 'COMPLETED';
