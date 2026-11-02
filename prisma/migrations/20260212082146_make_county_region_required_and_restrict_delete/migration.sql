/*
  Warnings:

  - Made the column `regionId` on table `counties` required. This step will fail if there are existing NULL values in that column.

*/
-- DropForeignKey
ALTER TABLE "counties" DROP CONSTRAINT "counties_regionId_fkey";

-- DropIndex
DROP INDEX "idx_counties_org_region";

-- AlterTable
ALTER TABLE "counties" ALTER COLUMN "regionId" SET NOT NULL;

-- CreateIndex
CREATE INDEX "idx_counties_region" ON "counties"("regionId");

-- CreateIndex
CREATE INDEX "idx_counties_org" ON "counties"("organizationId");

-- AddForeignKey
ALTER TABLE "counties" ADD CONSTRAINT "counties_regionId_fkey" FOREIGN KEY ("regionId") REFERENCES "regions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
