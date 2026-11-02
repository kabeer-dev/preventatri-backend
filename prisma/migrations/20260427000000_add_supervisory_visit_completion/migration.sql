-- Add completion fields to supervisory_visits
ALTER TABLE "supervisory_visits"
  ADD COLUMN "status"           TEXT NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "completion_notes" TEXT,
  ADD COLUMN "completed_at"     TIMESTAMP(3);
