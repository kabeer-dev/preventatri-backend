-- Adds the DRAFT template status value only. Kept in its own migration:
-- Postgres won't use a new enum value in the transaction adding it.
ALTER TYPE "ChecklistTemplateStatus" ADD VALUE IF NOT EXISTS 'DRAFT' BEFORE 'ACTIVE';
