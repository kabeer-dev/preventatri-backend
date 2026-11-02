-- Extend CaregiverStatus to the six statuses HHAeXchange exposes.
--
-- This is its own migration, ordered BEFORE the caregiver sync columns, for a
-- Postgres reason rather than a stylistic one: a value added by
-- ALTER TYPE ... ADD VALUE cannot be used in the same transaction that added
-- it. Keeping the enum change in a separate migration guarantees it is
-- committed before anything references HOLD / ON_LEAVE / TERMINATED / REJECTED.
--
-- Hand-authored like every recent migration here: DATABASE_URL points at a
-- Supabase transaction pooler with no directUrl/shadowDatabaseUrl, so
-- `prisma migrate dev` cannot run in this repo.

-- AlterEnum
ALTER TYPE "CaregiverStatus" ADD VALUE IF NOT EXISTS 'HOLD';
ALTER TYPE "CaregiverStatus" ADD VALUE IF NOT EXISTS 'ON_LEAVE';
ALTER TYPE "CaregiverStatus" ADD VALUE IF NOT EXISTS 'TERMINATED';
ALTER TYPE "CaregiverStatus" ADD VALUE IF NOT EXISTS 'REJECTED';
