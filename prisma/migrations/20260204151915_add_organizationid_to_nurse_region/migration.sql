/*
  Warnings:

  - Added the required column `organizationId` to the `nurse_regions` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "nurse_regions" ADD COLUMN     "organizationId" TEXT NOT NULL;

-- CreateIndex
CREATE INDEX "idx_nurse_regions_org_region" ON "nurse_regions"("organizationId", "regionId");

-- AddForeignKey
ALTER TABLE "nurse_regions" ADD CONSTRAINT "nurse_regions_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
