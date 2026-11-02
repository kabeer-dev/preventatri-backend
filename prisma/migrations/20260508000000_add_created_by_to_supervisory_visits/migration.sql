-- AlterTable
ALTER TABLE "supervisory_visits"
    ADD COLUMN "created_by" TEXT;

-- Backfill existing rows with an admin user from the same organization
UPDATE "supervisory_visits" sv
SET "created_by" = (
    SELECT uo."userId"
    FROM "user_organizations" uo
    WHERE uo."organizationId" = sv."organization_id"
      AND uo."role" = 'admin'
      AND uo."isActive" = TRUE
      AND uo."deleted_at" IS NULL
    ORDER BY uo."createdAt" ASC
    LIMIT 1
)
WHERE "created_by" IS NULL;

-- Enforce NOT NULL after backfill
ALTER TABLE "supervisory_visits"
    ALTER COLUMN "created_by" SET NOT NULL;

-- AddForeignKey
ALTER TABLE "supervisory_visits" ADD CONSTRAINT "supervisory_visits_created_by_fkey"
    FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "idx_supervisory_visits_created_by" ON "supervisory_visits"("created_by");
