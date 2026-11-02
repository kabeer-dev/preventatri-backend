-- AlterTable
ALTER TABLE "follow_up_tasks"
    ADD COLUMN "created_by" TEXT;

-- Backfill existing rows with an admin user from the same organization
UPDATE "follow_up_tasks" ft
SET "created_by" = (
    SELECT uo."userId"
    FROM "user_organizations" uo
    WHERE uo."organizationId" = ft."organization_id"
      AND uo."role" = 'admin'
      AND uo."isActive" = TRUE
      AND uo."deleted_at" IS NULL
    ORDER BY uo."createdAt" ASC
    LIMIT 1
)
WHERE "created_by" IS NULL;

-- Enforce NOT NULL after backfill
ALTER TABLE "follow_up_tasks"
    ALTER COLUMN "created_by" SET NOT NULL;

-- AddForeignKey
ALTER TABLE "follow_up_tasks" ADD CONSTRAINT "follow_up_tasks_created_by_fkey"
    FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "idx_follow_up_tasks_created_by" ON "follow_up_tasks"("created_by");
