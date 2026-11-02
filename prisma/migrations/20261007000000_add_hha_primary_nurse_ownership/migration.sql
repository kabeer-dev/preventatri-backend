-- Admin-picked primary nurse on HHAeXchange patients (PREVENT-745).
--
-- Additive only. The flag says whether HHAeXchange owns the primary nurse; the
-- declined id remembers the HHA nurse an admin turned down.

ALTER TABLE "patients"
  ADD COLUMN "is_primary_nurse_hha_managed" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "hha_declined_nurse_id" VARCHAR(32);

-- Every primary nurse on an HHA patient so far was set by the sync.
UPDATE "patients"
SET "is_primary_nurse_hha_managed" = true
WHERE "source" = 'HHA_EXCHANGE'
  AND "primary_nurse_profile_id" IS NOT NULL;
