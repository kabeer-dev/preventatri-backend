-- Escalation policies: the per-organization, per-flag-color escalation flow
-- (step order + minutes per step), stored as immutable versions. Each
-- escalation pins the version it started on, so a later policy edit never
-- changes flags that are already escalating.

-- AlterTable
ALTER TABLE "submission_flag_escalations" ADD COLUMN     "current_step_index" INTEGER,
ADD COLUMN     "policy_id" TEXT;

-- CreateTable
CREATE TABLE "escalation_policies" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "flag" "ChecklistRiskFlag" NOT NULL,
    "version" INTEGER NOT NULL,
    "steps" JSONB NOT NULL,
    "created_by" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "escalation_policies_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "unique_escalation_policy_version" ON "escalation_policies"("organization_id", "flag", "version");

-- CreateIndex
CREATE INDEX "submission_flag_escalations_policy_id_idx" ON "submission_flag_escalations"("policy_id");

-- AddForeignKey
ALTER TABLE "submission_flag_escalations" ADD CONSTRAINT "submission_flag_escalations_policy_id_fkey" FOREIGN KEY ("policy_id") REFERENCES "escalation_policies"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "escalation_policies" ADD CONSTRAINT "escalation_policies_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "escalation_policies" ADD CONSTRAINT "escalation_policies_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Seed version 1 of the RED and YELLOW policies for every organization with
-- the built-in flow (must match DEFAULT_ESCALATION_POLICY_STEPS): today's
-- minutes, and every step notified on every channel as before. created_by is
-- NULL: these are system defaults, not an admin's edit.
INSERT INTO "escalation_policies" ("id", "organization_id", "flag", "version", "steps", "created_by")
SELECT gen_random_uuid()::text, o."id", p."flag"::"ChecklistRiskFlag", 1, p."steps"::jsonb, NULL
FROM "organizations" o
CROSS JOIN (
    VALUES
        ('RED', '[{"type":"PRIMARY_NURSE","ttlMinutes":3,"ttlUnit":"MINUTES","channels":["IN_APP","EMAIL","SMS"]},{"type":"SECONDARY_NURSE","ttlMinutes":3,"ttlUnit":"MINUTES","channels":["IN_APP","EMAIL","SMS"]},{"type":"CASE_MANAGER","ttlMinutes":3,"ttlUnit":"MINUTES","channels":["IN_APP","EMAIL","SMS"]},{"type":"ADMIN","ttlMinutes":null,"ttlUnit":null,"channels":["IN_APP","EMAIL","SMS"]}]'),
        ('YELLOW', '[{"type":"PRIMARY_NURSE","ttlMinutes":5,"ttlUnit":"MINUTES","channels":["IN_APP","EMAIL","SMS"]},{"type":"SECONDARY_NURSE","ttlMinutes":5,"ttlUnit":"MINUTES","channels":["IN_APP","EMAIL","SMS"]},{"type":"CASE_MANAGER","ttlMinutes":5,"ttlUnit":"MINUTES","channels":["IN_APP","EMAIL","SMS"]},{"type":"ADMIN","ttlMinutes":null,"ttlUnit":null,"channels":["IN_APP","EMAIL","SMS"]}]')
) AS p("flag", "steps");

-- Pin every still-running escalation to its organization's version 1 and
-- record which step it is on, so the engine continues it exactly where it is.
-- Finished escalations are left NULL: they no longer advance, and pinning them
-- would claim they followed a policy that did not exist at the time.
UPDATE "submission_flag_escalations" e
SET "policy_id" = ep."id",
    "current_step_index" = CASE e."currentLevel"
        WHEN 'PATIENT_PRIMARY_NURSE' THEN 0
        WHEN 'REGION_PRIMARY_NURSE' THEN 0
        WHEN 'PATIENT_SECONDARY_NURSE' THEN 1
        WHEN 'REGION_SECONDARY_NURSE' THEN 1
        WHEN 'CASE_MANAGER' THEN 2
        WHEN 'ADMIN' THEN 3
    END
FROM "submission_flags" sf, "escalation_policies" ep
WHERE sf."id" = e."submission_flag_id"
  AND ep."organization_id" = e."organizationId"
  AND ep."flag" = sf."flag"
  AND ep."version" = 1
  AND e."status" IN ('ACTIVE', 'ACKNOWLEDGED');
