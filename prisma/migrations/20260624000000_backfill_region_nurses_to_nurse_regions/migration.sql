-- Backfill the NurseRegion roster from the legacy single primary/secondary
-- nurse FK columns on regions, so existing region default nurses become members
-- of the region's multi-nurse roster (the new source of truth for region nurses).
--
-- Data-only: this migration adds rows only. The regions."primary_nurse_profile_id"
-- / "secondary_nurse_profile_id" FK columns and their CHECK constraint are left
-- in place on purpose — they are still read by the escalation flow (owned by
-- separate work) and are not dropped here.
--
-- Idempotent / non-destructive:
--   * ON CONFLICT ("nurseProfileId", "regionId") DO NOTHING preserves any roster
--     row already created from the nurse side, so a nurse keeps its existing
--     single role for a region and is never duplicated.
--   * The unique("nurseProfileId", "regionId") index guarantees a nurse can hold
--     only one role per region (never both PRIMARY and SECONDARY).
--   * Soft-deleted regions and soft-deleted nurse profiles are skipped.

INSERT INTO "nurse_regions" (
  "id", "nurseProfileId", "regionId", "organizationId", "nurseRegionRole", "assignedAt"
)
SELECT
  gen_random_uuid()::text,
  r."primary_nurse_profile_id",
  r."id",
  r."organizationId",
  'PRIMARY'::"NurseRegionRole",
  CURRENT_TIMESTAMP
FROM "regions" r
JOIN "nurse_profiles" np ON np."id" = r."primary_nurse_profile_id"
WHERE r."primary_nurse_profile_id" IS NOT NULL
  AND r."deleted_at" IS NULL
  AND np."deleted_at" IS NULL
ON CONFLICT ("nurseProfileId", "regionId") DO NOTHING;

INSERT INTO "nurse_regions" (
  "id", "nurseProfileId", "regionId", "organizationId", "nurseRegionRole", "assignedAt"
)
SELECT
  gen_random_uuid()::text,
  r."secondary_nurse_profile_id",
  r."id",
  r."organizationId",
  'SECONDARY'::"NurseRegionRole",
  CURRENT_TIMESTAMP
FROM "regions" r
JOIN "nurse_profiles" np ON np."id" = r."secondary_nurse_profile_id"
WHERE r."secondary_nurse_profile_id" IS NOT NULL
  AND r."deleted_at" IS NULL
  AND np."deleted_at" IS NULL
ON CONFLICT ("nurseProfileId", "regionId") DO NOTHING;
