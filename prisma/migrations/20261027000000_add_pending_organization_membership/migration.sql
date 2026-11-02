-- A person who already has an account is invited into another organization and
-- joins only after accepting. The invitation lives on the membership, not on
-- the user, because one person can hold several.
--
-- An unaccepted invitation is a membership with "isActive" false and an
-- "invitationSentAt". "isActive" now means an accepted member, so memberships
-- that other organizations added directly before this change (inactive only
-- because they were not the person's main organization) become active.

ALTER TABLE "user_organizations"
  ADD COLUMN "invitationSentAt" TIMESTAMP(3),
  ADD COLUMN "invitationSecret" TEXT,
  ADD COLUMN "pendingProfileStatus" TEXT;

UPDATE "user_organizations"
SET "isActive" = true
WHERE "isActive" = false AND "deleted_at" IS NULL;
