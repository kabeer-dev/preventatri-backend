-- Terminal escalation levels (ADMIN) carry no TTL, so expires_at is null for
-- them. Make the column nullable to match the schema/computeEscalationExpiresAt;
-- without this, inserting a direct-to-ADMIN escalation (expires_at = null) fails
-- the NOT NULL constraint and the admin never gets assigned.
ALTER TABLE "submission_flag_escalations" ALTER COLUMN "expires_at" DROP NOT NULL;
