-- CreateEnum
CREATE TYPE "ChecklistTemplateStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- AlterTable
ALTER TABLE "users" ALTER COLUMN "secret_keys" SET DEFAULT '{"auth":null,"otp":null,"verification":null,"invitation":null,"loginReset":null,"accountUnlock":null}';

-- CreateTable
CREATE TABLE "checklist_templates" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "created_by" TEXT NOT NULL,
    "title" citext NOT NULL,
    "description" TEXT,
    "status" "ChecklistTemplateStatus" NOT NULL DEFAULT 'ACTIVE',
    "deleted_at" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "checklist_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "checklist_template_sections" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "title" VARCHAR(100) NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "checklist_template_sections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "checklist_template_questions" (
    "id" TEXT NOT NULL,
    "sectionId" TEXT NOT NULL,
    "title" VARCHAR(250) NOT NULL,
    "type" VARCHAR(20) NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "options" JSONB,
    "placeholder" VARCHAR(50),
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "checklist_template_questions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: Partial unique index for template title per organization (allows reuse if soft-deleted)
CREATE UNIQUE INDEX "unique_template_title_per_org" ON "checklist_templates"("title", "organizationId") WHERE "deleted_at" IS NULL;

-- CreateIndex
CREATE INDEX "idx_checklist_templates_org" ON "checklist_templates"("organizationId");

-- CreateIndex: Unique section title per template
CREATE UNIQUE INDEX "unique_section_title_per_template" ON "checklist_template_sections"("templateId", "title");

-- CreateIndex
CREATE INDEX "idx_checklist_sections_template" ON "checklist_template_sections"("templateId");

-- CreateIndex
CREATE INDEX "idx_checklist_questions_section" ON "checklist_template_questions"("sectionId");

-- AddForeignKey
ALTER TABLE "checklist_templates" ADD CONSTRAINT "checklist_templates_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checklist_templates" ADD CONSTRAINT "checklist_templates_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checklist_template_sections" ADD CONSTRAINT "checklist_template_sections_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "checklist_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checklist_template_questions" ADD CONSTRAINT "checklist_template_questions_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "checklist_template_sections"("id") ON DELETE CASCADE ON UPDATE CASCADE;
