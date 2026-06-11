-- Clio chat attachments (assistant-parity F1).
--
-- Uploaded via POST /clio/attachments; the chat stream request references rows
-- by id (the 1MB global JSON body limit rules out inlining base64 images in
-- the stream body). Documents store extracted text (pdf via unpdf, docx via
-- mammoth, plain text verbatim — clamped server-side); images store the raw
-- bytes so vision blocks can be rebuilt on regenerate/resend. message_id is a
-- plain column (no FK) so resend-mode message deletion never trips a
-- constraint; unconsumed rows (message_id IS NULL) older than 24h are swept
-- opportunistically on the next upload by the same user.
--
-- RLS: tenant-isolated, fail-closed, matching clio_messages. Policy functions
-- current_tenant_id() / rls_bypass() are defined in
-- 20260501000000_init_identity_tenancy.

CREATE TABLE "clio_attachments" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "message_id" UUID,
    "filename" VARCHAR(300) NOT NULL,
    "kind" VARCHAR(20) NOT NULL,
    "status" VARCHAR(20) NOT NULL,
    "media_type" VARCHAR(100),
    "byte_size" INTEGER NOT NULL,
    "pages" INTEGER,
    "text_content" TEXT,
    "reason" VARCHAR(300),
    "data" BYTEA,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    CONSTRAINT "clio_attachments_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "clio_attachments_kind_check" CHECK ("kind" IN ('pdf', 'docx', 'image', 'text')),
    CONSTRAINT "clio_attachments_status_check" CHECK ("status" IN ('parsed', 'truncated', 'scanned', 'image_ready', 'unsupported')),
    CONSTRAINT "clio_attachments_tenant_fkey" FOREIGN KEY ("tenant_id")
        REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "clio_attachments_user_fkey" FOREIGN KEY ("user_id")
        REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "clio_attachments_tenant_user_created_idx"
    ON "clio_attachments" ("tenant_id", "user_id", "created_at" DESC);
CREATE INDEX "clio_attachments_message_idx"
    ON "clio_attachments" ("message_id");

ALTER TABLE "clio_attachments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "clio_attachments" FORCE ROW LEVEL SECURITY;
CREATE POLICY "clio_attachments_isolation" ON "clio_attachments"
    USING (rls_bypass() OR tenant_id = current_tenant_id())
    WITH CHECK (rls_bypass() OR tenant_id = current_tenant_id());
