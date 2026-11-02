-- CreateTable
CREATE TABLE "counties" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "stateCode" VARCHAR(2) NOT NULL DEFAULT 'PA',
    "regionId" TEXT,
    "organizationId" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "counties_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_counties_org_region" ON "counties"("organizationId", "regionId");

-- CreateIndex
CREATE UNIQUE INDEX "unique_county_name_per_org" ON "counties"("name", "organizationId");

-- AddForeignKey
ALTER TABLE "counties" ADD CONSTRAINT "counties_regionId_fkey" FOREIGN KEY ("regionId") REFERENCES "regions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "counties" ADD CONSTRAINT "counties_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
