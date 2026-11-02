/*
  Warnings:

  - You are about to drop the `entities` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "entities" DROP CONSTRAINT "entities_organizationId_fkey";

-- DropForeignKey
ALTER TABLE "entities" DROP CONSTRAINT "entities_userId_fkey";

-- AlterTable
ALTER TABLE "permissions" ALTER COLUMN "levels" SET DEFAULT '{"users":{"view":[],"update":[]},"region":{"view":[],"update":[]}}';

-- Backfill existing permissions.levels:
-- 1. Remove 'entities' key
-- 2. Ensure 'region' key exists with default structure if missing
UPDATE "permissions"
SET "levels" = 
  CASE 
    WHEN "levels" ? 'region' THEN
      -- region exists: just remove entities
      "levels" - 'entities'
    ELSE
      -- region doesn't exist: remove entities and add region
      ("levels" - 'entities') || '{"region":{"view":[],"update":[]}}'::jsonb
  END
WHERE "levels" IS NOT NULL;

-- DropTable
DROP TABLE "entities";
