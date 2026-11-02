ALTER TABLE "supervisory_visits"
  ADD COLUMN "answers" JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN "completion_source" TEXT;

-- Backfill: any visit already marked COMPLETED came in via the manual /complete
-- endpoint (the only path that existed before this column). Tag them so the
-- detail response can distinguish them from new answer-submitted completions.
UPDATE "supervisory_visits"
   SET "completion_source" = 'MANUAL_COMPLETE'
 WHERE "status" = 'COMPLETED'
   AND "completion_source" IS NULL;
