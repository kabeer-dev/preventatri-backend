-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('critical', 'high', 'low');

-- Priority indicator of a notification. Existing rows default to 'low'.
ALTER TABLE "notifications" ADD COLUMN "type" "NotificationType" NOT NULL DEFAULT 'low';
