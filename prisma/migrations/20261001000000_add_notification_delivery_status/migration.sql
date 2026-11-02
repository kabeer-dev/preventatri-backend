-- Per-channel (email / SMS) delivery outcome of a notification.

-- CreateEnum
CREATE TYPE "NotificationDeliveryStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'BLOCKED_IN_ESCALATION_POLICY', 'NOT_IN_WORKING_HOURS', 'NOT_REQUESTED', 'DISABLED', 'NO_CONTACT');

-- AlterTable
ALTER TABLE "notifications" ADD COLUMN     "email_error" TEXT,
ADD COLUMN     "email_status" "NotificationDeliveryStatus" NOT NULL DEFAULT 'NOT_REQUESTED',
ADD COLUMN     "sms_error" TEXT,
ADD COLUMN     "sms_status" "NotificationDeliveryStatus" NOT NULL DEFAULT 'NOT_REQUESTED';
