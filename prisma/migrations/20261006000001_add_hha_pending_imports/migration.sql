-- HHAeXchange people waiting for a unique login email (PREVENT-732).
--
-- Additive only. A person whose HHA email already belongs to someone else is
-- not imported; the row holds who they are and the email an admin gives them.

CREATE TABLE "hha_pending_imports" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "resource" VARCHAR(16) NOT NULL,
  "hha_record_id" VARCHAR(64) NOT NULL,
  "name" VARCHAR(200) NOT NULL,
  "hha_email" VARCHAR(255) NOT NULL,
  "login_email" VARCHAR(255),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "hha_pending_imports_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "hha_pending_imports_organization_id_fkey" FOREIGN KEY ("organization_id")
    REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "uq_hha_pending_imports_org_record"
  ON "hha_pending_imports"("organization_id", "resource", "hha_record_id");

CREATE INDEX "idx_hha_pending_imports_org_email"
  ON "hha_pending_imports"("organization_id", "hha_email");
