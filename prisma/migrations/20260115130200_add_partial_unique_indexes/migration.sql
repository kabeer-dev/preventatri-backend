-- CreateIndex: Partial unique index for email per organization (allows reuse if deleted or different org)
CREATE UNIQUE INDEX "unique_email_per_org" ON "users"("email", "primary_org_id") WHERE "deleted_at" IS NULL;

-- CreateIndex: Partial unique index for phone per organization (allows reuse if deleted or different org)
CREATE UNIQUE INDEX "unique_phone_per_org" ON "users"("phoneNo", "primary_org_id") WHERE "deleted_at" IS NULL;
