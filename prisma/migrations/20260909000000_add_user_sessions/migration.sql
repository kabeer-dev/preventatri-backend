-- Hand-authored, same reason as the other recent hand-authored migrations
-- (see e.g. 20260904000000_add_hha_exchange_nurse_sync): DATABASE_URL points
-- at a Supabase transaction pooler with no directUrl/shadowDatabaseUrl
-- wired into prisma.config.ts, so `prisma migrate dev` cannot compute a
-- shadow-database diff here. This mirrors exactly what `prisma migrate dev`
-- would generate for the UserSession model added to prisma/schema.prisma.

-- CreateTable
CREATE TABLE "user_sessions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "secret_key" TEXT NOT NULL,
    "user_agent" TEXT,
    "ip_address" TEXT,
    "platform" TEXT,
    "last_active_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "user_sessions_user_id_idx" ON "user_sessions"("user_id");

-- AddForeignKey
ALTER TABLE "user_sessions" ADD CONSTRAINT "user_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
