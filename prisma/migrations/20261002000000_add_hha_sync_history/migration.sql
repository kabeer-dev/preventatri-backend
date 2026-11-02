-- HHAeXchange sync history (PREVENT-719).
--
-- Additive only. hha_sync_runs records each run; hha_sync_exceptions is the
-- admin worklist, one row per problem, deduplicated across runs by dedupe_key.
-- Written by hand: the pooler DATABASE_URL has no shadow database.

CREATE TABLE "hha_sync_runs" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "trigger" VARCHAR(16) NOT NULL,
  "requested_by_user_id" TEXT,
  "status" VARCHAR(16) NOT NULL,
  "error_id" VARCHAR(64),
  "summaries" JSONB NOT NULL DEFAULT '{}',
  "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finished_at" TIMESTAMPTZ(3),

  CONSTRAINT "hha_sync_runs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "hha_sync_runs_organization_id_fkey" FOREIGN KEY ("organization_id")
    REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "idx_hha_sync_runs_org_started"
  ON "hha_sync_runs"("organization_id", "started_at");

CREATE TABLE "hha_sync_exceptions" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "dedupe_key" VARCHAR(255) NOT NULL,
  "resource" VARCHAR(16) NOT NULL,
  "type" VARCHAR(64) NOT NULL,
  "hha_record_id" VARCHAR(64),
  "related_user_id" TEXT,
  "detail" VARCHAR(255),
  "status" VARCHAR(16) NOT NULL DEFAULT 'OPEN',
  "occurrences" INTEGER NOT NULL DEFAULT 1,
  "first_seen_run_id" TEXT NOT NULL,
  "last_seen_run_id" TEXT NOT NULL,
  "first_seen_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_seen_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolved_at" TIMESTAMPTZ(3),
  "resolved_by_user_id" TEXT,
  "resolution_note" VARCHAR(500),

  CONSTRAINT "hha_sync_exceptions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "hha_sync_exceptions_organization_id_fkey" FOREIGN KEY ("organization_id")
    REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "uq_hha_sync_exceptions_org_key"
  ON "hha_sync_exceptions"("organization_id", "dedupe_key");

CREATE INDEX "idx_hha_sync_exceptions_org_status_type"
  ON "hha_sync_exceptions"("organization_id", "status", "type");

CREATE INDEX "idx_hha_sync_exceptions_org_resource_status"
  ON "hha_sync_exceptions"("organization_id", "resource", "status");
