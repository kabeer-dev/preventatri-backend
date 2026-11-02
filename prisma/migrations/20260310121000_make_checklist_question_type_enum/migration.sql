-- CreateEnum
CREATE TYPE "ChecklistQuestionType" AS ENUM (
  'textarea',
  'number',
  'boolean',
  'select',
  'multiSelect',
  'date',
  'checkbox'
);

-- AlterTable
ALTER TABLE "checklist_template_questions"
ALTER COLUMN "type" TYPE "ChecklistQuestionType"
USING ("type"::"ChecklistQuestionType");
