-- AlterTable
ALTER TABLE "submission_flags" ADD COLUMN "voided_by" TEXT;

-- AddForeignKey
ALTER TABLE "submission_flags" ADD CONSTRAINT "submission_flags_voided_by_fkey" FOREIGN KEY ("voided_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
