-- HHAeXchange links only for active nurses and case managers.
--
-- Additive only. The pending ids say who HHAeXchange names but cannot be linked
-- yet; the flag and the declined id give the case manager the ownership the
-- primary nurse already has.

ALTER TABLE "patients"
  ADD COLUMN "hha_pending_nurse_profile_id" TEXT,
  ADD COLUMN "hha_pending_case_manager_profile_id" TEXT,
  ADD COLUMN "is_case_manager_hha_managed" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "hha_declined_case_manager_profile_id" TEXT,
  ADD CONSTRAINT "patients_hha_pending_nurse_profile_id_fkey"
    FOREIGN KEY ("hha_pending_nurse_profile_id")
    REFERENCES "nurse_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "patients_hha_pending_case_manager_profile_id_fkey"
    FOREIGN KEY ("hha_pending_case_manager_profile_id")
    REFERENCES "case_manager_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "idx_patients_hha_pending_nurse"
  ON "patients"("hha_pending_nurse_profile_id")
  WHERE "hha_pending_nurse_profile_id" IS NOT NULL;

CREATE INDEX "idx_patients_hha_pending_case_manager"
  ON "patients"("hha_pending_case_manager_profile_id")
  WHERE "hha_pending_case_manager_profile_id" IS NOT NULL;

-- Every case manager on an HHA patient so far was set by the sync.
UPDATE "patients"
SET "is_case_manager_hha_managed" = true
WHERE "source" = 'HHA_EXCHANGE'
  AND EXISTS (
    SELECT 1 FROM "case_manager_patients" cmp
    WHERE cmp."patientId" = "patients"."id"
  );
