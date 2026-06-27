-- CreateEnum
CREATE TYPE "ws_doc_status" AS ENUM ('draft', 'complete');

-- CreateEnum
CREATE TYPE "ws_role" AS ENUM ('editor', 'reviewer', 'viewer', 'commenter');

-- CreateTable
CREATE TABLE "ws_draft" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "doc_title" TEXT NOT NULL,
    "industry" TEXT,
    "product" TEXT,
    "client" TEXT,
    "status" "ws_doc_status" NOT NULL DEFAULT 'draft',
    "is_packet" BOOLEAN NOT NULL DEFAULT false,
    "doc_count" INTEGER NOT NULL DEFAULT 1,
    "ask" JSONB,
    "config" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ws_draft_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ws_document" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "draft_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL DEFAULT 0,
    "body" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ws_document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ws_template" (
    "id" UUID NOT NULL,
    "tenant_id" UUID,
    "name" TEXT NOT NULL,
    "icon" TEXT,
    "description" TEXT,
    "product" TEXT NOT NULL,
    "style" TEXT,
    "font_family" TEXT,
    "accent_color" TEXT,
    "meri_primary" BOOLEAN NOT NULL DEFAULT false,
    "meri_secondary" BOOLEAN NOT NULL DEFAULT false,
    "elements" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "sections" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ws_template_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ws_comment" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "author_id" UUID NOT NULL,
    "role" "ws_role" NOT NULL DEFAULT 'editor',
    "quote" TEXT,
    "anchor" JSONB,
    "body" TEXT NOT NULL,
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "parent_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ws_comment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ws_context_item" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "draft_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ws_context_item_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ws_draft_tenant_id_idx" ON "ws_draft"("tenant_id");

-- CreateIndex
CREATE INDEX "ws_draft_tenant_id_owner_id_idx" ON "ws_draft"("tenant_id", "owner_id");

-- CreateIndex
CREATE INDEX "ws_draft_tenant_id_updated_at_idx" ON "ws_draft"("tenant_id", "updated_at");

-- CreateIndex
CREATE INDEX "ws_document_tenant_id_idx" ON "ws_document"("tenant_id");

-- CreateIndex
CREATE INDEX "ws_document_draft_id_idx" ON "ws_document"("draft_id");

-- CreateIndex
CREATE INDEX "ws_template_product_idx" ON "ws_template"("product");

-- CreateIndex
CREATE INDEX "ws_template_tenant_id_idx" ON "ws_template"("tenant_id");

-- CreateIndex
CREATE INDEX "ws_comment_tenant_id_idx" ON "ws_comment"("tenant_id");

-- CreateIndex
CREATE INDEX "ws_comment_document_id_idx" ON "ws_comment"("document_id");

-- CreateIndex
CREATE INDEX "ws_comment_parent_id_idx" ON "ws_comment"("parent_id");

-- CreateIndex
CREATE INDEX "ws_context_item_tenant_id_idx" ON "ws_context_item"("tenant_id");

-- CreateIndex
CREATE INDEX "ws_context_item_draft_id_idx" ON "ws_context_item"("draft_id");

-- AddForeignKey
ALTER TABLE "ws_document" ADD CONSTRAINT "ws_document_draft_id_fkey" FOREIGN KEY ("draft_id") REFERENCES "ws_draft"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ws_comment" ADD CONSTRAINT "ws_comment_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "ws_document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ws_comment" ADD CONSTRAINT "ws_comment_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "ws_comment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ws_context_item" ADD CONSTRAINT "ws_context_item_draft_id_fkey" FOREIGN KEY ("draft_id") REFERENCES "ws_draft"("id") ON DELETE CASCADE ON UPDATE CASCADE;

