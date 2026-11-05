-- Each organization keeps its own HHAeXchange credentials. The secret and key
-- are stored encrypted by the app; the organization that used the single global
-- set is moved over by prisma/seedHhaCredentials.js.

CREATE TABLE IF NOT EXISTS "organization_hha_credentials" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "app_name" VARCHAR(255) NOT NULL,
  "encrypted_app_secret" TEXT NOT NULL,
  "encrypted_app_key" TEXT NOT NULL,
  "is_connected" BOOLEAN NOT NULL DEFAULT false,
  "last_verified_at" TIMESTAMPTZ(3),
  "last_error" VARCHAR(255),
  "connected_by_user_id" TEXT,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "organization_hha_credentials_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "organization_hha_credentials_organization_id_key"
  ON "organization_hha_credentials"("organization_id");

ALTER TABLE "organization_hha_credentials"
  ADD CONSTRAINT "organization_hha_credentials_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
