-- A person's name, phone and address now live on their membership, so a change
-- in one organization never reaches another. The columns on users stay as the
-- account's starting values.

ALTER TABLE "user_organizations"
  ADD COLUMN IF NOT EXISTS "firstName" TEXT,
  ADD COLUMN IF NOT EXISTS "lastName" TEXT,
  ADD COLUMN IF NOT EXISTS "phoneNo" VARCHAR(20),
  ADD COLUMN IF NOT EXISTS "address" VARCHAR(500),
  ADD COLUMN IF NOT EXISTS "city" VARCHAR(100),
  ADD COLUMN IF NOT EXISTS "zip_code" VARCHAR(10),
  ADD COLUMN IF NOT EXISTS "state" VARCHAR(50);

-- Every existing membership starts with the account's current values.
UPDATE "user_organizations" uo
SET "firstName" = u."firstName",
    "lastName" = u."lastName",
    "phoneNo" = u."phoneNo",
    "address" = u."address",
    "city" = u."city",
    "zip_code" = u."zip_code",
    "state" = u."state"
FROM "users" u
WHERE u."id" = uo."userId";

-- Each role profile points at its membership. NOT VALID keeps a profile that
-- never had a membership from blocking the migration while still checking
-- every new row.
ALTER TABLE "nurse_profiles"
  ADD CONSTRAINT "nurse_profiles_userId_organizationId_fkey"
  FOREIGN KEY ("userId", "organizationId")
  REFERENCES "user_organizations"("userId", "organizationId")
  ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;

ALTER TABLE "caregiver_profiles"
  ADD CONSTRAINT "caregiver_profiles_userId_organizationId_fkey"
  FOREIGN KEY ("userId", "organizationId")
  REFERENCES "user_organizations"("userId", "organizationId")
  ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;

ALTER TABLE "case_manager_profiles"
  ADD CONSTRAINT "case_manager_profiles_userId_organizationId_fkey"
  FOREIGN KEY ("userId", "organizationId")
  REFERENCES "user_organizations"("userId", "organizationId")
  ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;
