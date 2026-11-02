-- A patient with no county has no region, but a flag raised on them still has
-- to reach someone. Such an escalation starts at ADMIN and carries no region,
-- so regionId must be nullable; without this the insert fails the NOT NULL
-- constraint and the flag is never assigned to anyone. The sibling migration
-- 20260617000000 made expires_at nullable for the same direct-to-ADMIN case.
ALTER TABLE "submission_flag_escalations" ALTER COLUMN "regionId" DROP NOT NULL;
