-- HHAeXchange sync change history (PREVENT-719).
--
-- Additive only. One row per record a run created or changed, with the old and
-- new value of each field. Patient fields are stored with their values too.

CREATE TABLE "hha_sync_changes" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "run_id" TEXT NOT NULL,
  "resource" VARCHAR(16) NOT NULL,
  "action" VARCHAR(16) NOT NULL,
  "hha_record_id" VARCHAR(64) NOT NULL,
  "changes" JSONB NOT NULL DEFAULT '[]',
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "hha_sync_changes_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "hha_sync_changes_organization_id_fkey" FOREIGN KEY ("organization_id")
    REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "idx_hha_sync_changes_org_created"
  ON "hha_sync_changes"("organization_id", "created_at");

CREATE INDEX "idx_hha_sync_changes_run" ON "hha_sync_changes"("run_id");

CREATE INDEX "idx_hha_sync_changes_org_record"
  ON "hha_sync_changes"("organization_id", "resource", "hha_record_id");
