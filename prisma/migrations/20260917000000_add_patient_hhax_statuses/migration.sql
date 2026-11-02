-- Adds the HHAeXchange patient statuses WAITING, HOSPITALIZED and HOLD, which
-- the sync previously flattened into INACTIVE, plus ARCHIVED. Kept in its own
-- migration: Postgres won't use a new enum value in the transaction adding it.
ALTER TYPE "PatientStatus" ADD VALUE IF NOT EXISTS 'WAITING';
ALTER TYPE "PatientStatus" ADD VALUE IF NOT EXISTS 'HOSPITALIZED';
ALTER TYPE "PatientStatus" ADD VALUE IF NOT EXISTS 'HOLD';
ALTER TYPE "PatientStatus" ADD VALUE IF NOT EXISTS 'ARCHIVED';
