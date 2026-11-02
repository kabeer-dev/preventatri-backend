-- Weekly working hours for an organization, defaulting to 9:00 AM - 5:00 PM
-- every day except Sunday (closed by default).
-- Existing rows are backfilled with this same default (NOT NULL DEFAULT on ADD COLUMN).
ALTER TABLE "organizations" ADD COLUMN "working_hours" JSONB NOT NULL DEFAULT '{"monday":{"enabled":true,"startTime":"09:00","endTime":"17:00"},"tuesday":{"enabled":true,"startTime":"09:00","endTime":"17:00"},"wednesday":{"enabled":true,"startTime":"09:00","endTime":"17:00"},"thursday":{"enabled":true,"startTime":"09:00","endTime":"17:00"},"friday":{"enabled":true,"startTime":"09:00","endTime":"17:00"},"saturday":{"enabled":true,"startTime":"09:00","endTime":"17:00"},"sunday":{"enabled":false,"startTime":"09:00","endTime":"17:00"}}';
