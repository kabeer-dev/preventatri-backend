-- Hand-authored, same reason as the other recent hand-authored migrations
-- (see e.g. 20260909000000_add_user_sessions): DATABASE_URL points at a
-- Supabase transaction pooler with no directUrl/shadowDatabaseUrl wired into
-- prisma.config.ts, so `prisma migrate dev` cannot compute a shadow-database
-- diff here. This mirrors exactly what `prisma migrate dev` would generate
-- for the Security model added to prisma/schema.prisma.

-- CreateTable
CREATE TABLE "securities" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "otp_notifications" JSONB NOT NULL DEFAULT '{"email":false,"phone":false}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "securities_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "securities_user_id_key" ON "securities"("user_id");

-- AddForeignKey
ALTER TABLE "securities" ADD CONSTRAINT "securities_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
