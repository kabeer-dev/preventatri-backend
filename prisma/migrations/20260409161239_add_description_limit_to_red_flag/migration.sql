-- Truncate any existing descriptions that exceed 5000 characters
UPDATE "red_flags"
SET "description" = LEFT("description", 5000)
WHERE "description" IS NOT NULL
  AND LENGTH("description") > 5000;

-- AlterColumn: Change description from Text to VarChar(5000)
ALTER TABLE "red_flags" ALTER COLUMN "description" TYPE varchar(5000);
