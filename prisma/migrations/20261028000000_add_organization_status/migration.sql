-- A new organization from signup starts pending and nobody in it can log in
-- until it is approved. Every existing organization stays active, so nobody is
-- locked out by this change.

CREATE TYPE "OrganizationStatus" AS ENUM ('pending', 'active');

ALTER TABLE "organizations"
  ADD COLUMN "status" "OrganizationStatus" NOT NULL DEFAULT 'active';
