-- The patient a notification is about, so a caregiver's feed can hide rows for
-- patients they can no longer open.
--
-- Additive only. Existing rows are filled from the record they link to; rows
-- whose record is gone stay NULL.

ALTER TABLE "notifications" ADD COLUMN "patient_id" TEXT;

ALTER TABLE "notifications"
  ADD CONSTRAINT "notifications_patient_id_fkey"
  FOREIGN KEY ("patient_id") REFERENCES "patients"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "notifications_patient_id_idx" ON "notifications"("patient_id");

UPDATE "notifications" n
SET "patient_id" = f."patientId"
FROM "submission_flags" f
WHERE n."document_type" = 'FLAG' AND f."id" = n."document_id";

-- follow_up_tasks.id and supervisory_visits.id are uuid; document_id is text.
UPDATE "notifications" n
SET "patient_id" = t."patient_id"
FROM "follow_up_tasks" t
WHERE n."document_type" = 'FOLLOWUPTASK' AND t."id"::text = n."document_id";

UPDATE "notifications" n
SET "patient_id" = v."patient_id"
FROM "supervisory_visits" v
WHERE n."document_type" = 'SUPERVISORYVISIT' AND v."id"::text = n."document_id";
