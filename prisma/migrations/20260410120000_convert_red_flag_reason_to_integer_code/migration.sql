-- Convert red_flags.reason from RedFlagReason enum to integer codes
-- Mapping: fall_or_injury=0, sudden_health_decline=1, unresponsive=2,
--          severe_pain=3, difficulty_breathing=4, medication_issue=5, other=6

-- Step 1: Add a temporary integer column
ALTER TABLE "red_flags" ADD COLUMN "reason_code" INTEGER;

-- Step 2: Map existing enum values to integer codes
UPDATE "red_flags" SET "reason_code" = CASE "reason"::text
  WHEN 'fall_or_injury' THEN 0
  WHEN 'sudden_health_decline' THEN 1
  WHEN 'unresponsive' THEN 2
  WHEN 'severe_pain' THEN 3
  WHEN 'difficulty_breathing' THEN 4
  WHEN 'medication_issue' THEN 5
  WHEN 'other' THEN 6
END;

-- Step 3: Drop the old enum column
ALTER TABLE "red_flags" DROP COLUMN "reason";

-- Step 4: Rename the new column
ALTER TABLE "red_flags" RENAME COLUMN "reason_code" TO "reason";

-- Step 5: Set NOT NULL constraint
ALTER TABLE "red_flags" ALTER COLUMN "reason" SET NOT NULL;

-- Step 6: Drop the enum type
DROP TYPE "RedFlagReason";
