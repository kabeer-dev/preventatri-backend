-- Track who completed a supervisory visit (case manager, admin, or nurse).
-- Existing records remain NULL.
ALTER TABLE "supervisory_visits"
  ADD COLUMN "completed_by" TEXT;

-- AddForeignKey
ALTER TABLE "supervisory_visits" ADD CONSTRAINT "supervisory_visits_completed_by_fkey"
    FOREIGN KEY ("completed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "idx_supervisory_visits_completed_by" ON "supervisory_visits"("completed_by");
