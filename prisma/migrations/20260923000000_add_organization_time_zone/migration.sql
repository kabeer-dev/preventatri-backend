-- Selected time zone for an organization, restricted to the 6 supported USA
-- time zones. NOT NULL DEFAULT on ADD COLUMN backfills existing rows with
-- the same default used for newly created organizations.
CREATE TYPE "OrganizationTimeZone" AS ENUM ('EASTERN', 'CENTRAL', 'MOUNTAIN', 'PACIFIC', 'ALASKA', 'HAWAII');

ALTER TABLE "organizations" ADD COLUMN "time_zone" "OrganizationTimeZone" NOT NULL DEFAULT 'EASTERN';
