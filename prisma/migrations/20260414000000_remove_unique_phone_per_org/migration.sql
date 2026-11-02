-- Remove unique constraint on (phoneNo, primary_org_id) for users
-- Phone numbers are no longer required to be unique per organization
DROP INDEX IF EXISTS "unique_phone_per_org";
