-- PREVENT-411: Separate a region's DEFAULT nurse roster from a nurse's own
-- region coverage.
--
-- Until now both concepts shared the single "regional_nurses" table, so editing
-- a nurse's regions (Nurse page) and editing a region's nurses (Region page)
-- silently rewrote each other. This creates a dedicated "region_default_nurses" table
-- that owns the region-side roster (region display, summary counts,
-- GET /regions/:id/nurses, and escalation routing). "regional_nurses" stays as
-- the nurse-owned coverage roster.
--
-- Backfill copies the current "regional_nurses" rows into "region_default_nurses" so a
-- region's default nurses are identical to today's data at cut-over; the two
-- rosters then evolve independently. Non-destructive: ON CONFLICT DO NOTHING and
-- "regional_nurses" is left untouched.

-- CreateTable
CREATE TABLE "region_default_nurses" (
    "id" TEXT NOT NULL,
    "nurseProfileId" TEXT NOT NULL,
    "regionId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "nurseRegionRole" "NurseRegionRole" NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "region_default_nurses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "unique_region_default_nurse_assignment" ON "region_default_nurses"("nurseProfileId", "regionId");

-- CreateIndex
CREATE INDEX "idx_region_default_nurses_org_region" ON "region_default_nurses"("organizationId", "regionId");

-- AddForeignKey
ALTER TABLE "region_default_nurses" ADD CONSTRAINT "region_default_nurses_nurseProfileId_fkey" FOREIGN KEY ("nurseProfileId") REFERENCES "nurse_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "region_default_nurses" ADD CONSTRAINT "region_default_nurses_regionId_fkey" FOREIGN KEY ("regionId") REFERENCES "regions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "region_default_nurses" ADD CONSTRAINT "region_default_nurses_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: a region's default nurses == the current shared roster at cut-over.
INSERT INTO "region_default_nurses" (
  "id", "nurseProfileId", "regionId", "organizationId", "nurseRegionRole", "assignedAt"
)
SELECT
  gen_random_uuid()::text,
  "nurseProfileId",
  "regionId",
  "organizationId",
  "nurseRegionRole",
  "assignedAt"
FROM "regional_nurses"
ON CONFLICT ("nurseProfileId", "regionId") DO NOTHING;
