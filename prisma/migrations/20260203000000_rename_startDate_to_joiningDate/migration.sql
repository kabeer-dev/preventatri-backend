-- Rename startDate to joiningDate in nurse_profiles table for semantic clarity
-- This represents when the nurse joined/started employment
ALTER TABLE "nurse_profiles" RENAME COLUMN "startDate" TO "joiningDate";
