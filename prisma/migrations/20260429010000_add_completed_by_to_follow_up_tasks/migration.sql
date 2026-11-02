-- AlterTable
ALTER TABLE "follow_up_tasks"
    ADD COLUMN "completed_by" TEXT;

-- AddForeignKey
ALTER TABLE "follow_up_tasks" ADD CONSTRAINT "follow_up_tasks_completed_by_fkey"
    FOREIGN KEY ("completed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "idx_follow_up_tasks_completed_by" ON "follow_up_tasks"("completed_by");
