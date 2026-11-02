/*
  Warnings:

  - You are about to alter the column `emergencyContact` on the `patients` table. The data in that column could be lost. The data in that column will be cast from `VarChar(255)` to `VarChar(20)`.

*/
-- AlterTable
ALTER TABLE "patients" ALTER COLUMN "emergencyContact" SET DATA TYPE VARCHAR(20);
