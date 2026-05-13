-- Per-user Clio email address. Three tables: the mailbox itself,
-- inbound messages, outbound messages. See ClioMailbox / ClioInboundMail /
-- ClioOutboundMail in schema.prisma for column-by-column comments, and
-- OVERNIGHT_DECISIONS_LOCKED.md §4 for the design.

-- ---------------------------------------------------------------------------
-- clio_mailboxes — one per Capiro user
CREATE TABLE "clio_mailboxes" (
  "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
  "tenant_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "local_part" TEXT NOT NULL,
  "full_address" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT TRUE,
  "auto_reply" BOOLEAN NOT NULL DEFAULT FALSE,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  CONSTRAINT "clio_mailboxes_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "clio_mailboxes_tenant_fkey" FOREIGN KEY ("tenant_id")
    REFERENCES "tenants"("id") ON DELETE CASCADE,
  CONSTRAINT "clio_mailboxes_user_fkey" FOREIGN KEY ("user_id")
    REFERENCES "users"("id") ON DELETE CASCADE,
  CONSTRAINT "clio_mailboxes_user_unique" UNIQUE ("user_id"),
  CONSTRAINT "clio_mailboxes_local_part_unique" UNIQUE ("local_part"),
  CONSTRAINT "clio_mailboxes_full_address_unique" UNIQUE ("full_address"),
  CONSTRAINT "clio_mailboxes_local_part_format"
    CHECK ("local_part" ~ '^[a-z0-9-]{2,40}$')
);

CREATE INDEX "clio_mailboxes_tenant_user_idx"
  ON "clio_mailboxes" ("tenant_id", "user_id");

CREATE TRIGGER "clio_mailboxes_set_updated_at"
  BEFORE UPDATE ON "clio_mailboxes"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE "clio_mailboxes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "clio_mailboxes" FORCE ROW LEVEL SECURITY;
CREATE POLICY "clio_mailboxes_isolation" ON "clio_mailboxes"
  USING (rls_bypass() OR tenant_id = current_tenant_id())
  WITH CHECK (rls_bypass() OR tenant_id = current_tenant_id());

-- ---------------------------------------------------------------------------
-- clio_inbound_mail — every email Clio received
CREATE TABLE "clio_inbound_mail" (
  "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
  "tenant_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "mailbox_id" UUID NOT NULL,
  "ses_message_id" TEXT NOT NULL,
  "raw_s3_key" TEXT NOT NULL,
  "from_address" TEXT NOT NULL,
  "from_name" TEXT,
  "to_address" TEXT NOT NULL,
  "subject" TEXT NOT NULL,
  "body_text" TEXT,
  "body_html" TEXT,
  "received_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  "processed_at" TIMESTAMPTZ(6),
  "clio_session_id" UUID,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "error_message" TEXT,
  CONSTRAINT "clio_inbound_mail_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "clio_inbound_mail_tenant_fkey" FOREIGN KEY ("tenant_id")
    REFERENCES "tenants"("id") ON DELETE CASCADE,
  CONSTRAINT "clio_inbound_mail_user_fkey" FOREIGN KEY ("user_id")
    REFERENCES "users"("id") ON DELETE CASCADE,
  CONSTRAINT "clio_inbound_mail_mailbox_fkey" FOREIGN KEY ("mailbox_id")
    REFERENCES "clio_mailboxes"("id") ON DELETE CASCADE,
  CONSTRAINT "clio_inbound_mail_ses_message_id_unique" UNIQUE ("ses_message_id"),
  CONSTRAINT "clio_inbound_mail_status_check"
    CHECK ("status" IN ('pending', 'processed', 'replied', 'ignored', 'error'))
);

CREATE INDEX "clio_inbound_mail_tenant_user_received_idx"
  ON "clio_inbound_mail" ("tenant_id", "user_id", "received_at" DESC);
CREATE INDEX "clio_inbound_mail_mailbox_received_idx"
  ON "clio_inbound_mail" ("mailbox_id", "received_at" DESC);

ALTER TABLE "clio_inbound_mail" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "clio_inbound_mail" FORCE ROW LEVEL SECURITY;
CREATE POLICY "clio_inbound_mail_isolation" ON "clio_inbound_mail"
  USING (rls_bypass() OR tenant_id = current_tenant_id())
  WITH CHECK (rls_bypass() OR tenant_id = current_tenant_id());

-- ---------------------------------------------------------------------------
-- clio_outbound_mail — every email Clio sent
CREATE TABLE "clio_outbound_mail" (
  "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
  "tenant_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "mailbox_id" UUID NOT NULL,
  "clio_session_id" UUID,
  "in_reply_to_id" UUID,
  "ses_message_id" TEXT,
  "to_address" TEXT NOT NULL,
  "cc_address" TEXT,
  "subject" TEXT NOT NULL,
  "body_text" TEXT NOT NULL,
  "body_html" TEXT,
  "sent_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  CONSTRAINT "clio_outbound_mail_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "clio_outbound_mail_tenant_fkey" FOREIGN KEY ("tenant_id")
    REFERENCES "tenants"("id") ON DELETE CASCADE,
  CONSTRAINT "clio_outbound_mail_user_fkey" FOREIGN KEY ("user_id")
    REFERENCES "users"("id") ON DELETE CASCADE,
  CONSTRAINT "clio_outbound_mail_mailbox_fkey" FOREIGN KEY ("mailbox_id")
    REFERENCES "clio_mailboxes"("id") ON DELETE CASCADE,
  CONSTRAINT "clio_outbound_mail_in_reply_to_fkey" FOREIGN KEY ("in_reply_to_id")
    REFERENCES "clio_inbound_mail"("id") ON DELETE SET NULL
);

CREATE INDEX "clio_outbound_mail_tenant_user_sent_idx"
  ON "clio_outbound_mail" ("tenant_id", "user_id", "sent_at" DESC);
CREATE INDEX "clio_outbound_mail_mailbox_sent_idx"
  ON "clio_outbound_mail" ("mailbox_id", "sent_at" DESC);

ALTER TABLE "clio_outbound_mail" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "clio_outbound_mail" FORCE ROW LEVEL SECURITY;
CREATE POLICY "clio_outbound_mail_isolation" ON "clio_outbound_mail"
  USING (rls_bypass() OR tenant_id = current_tenant_id())
  WITH CHECK (rls_bypass() OR tenant_id = current_tenant_id());

-- ---------------------------------------------------------------------------
-- Grants for the runtime capiro_app role.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'capiro_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "clio_mailboxes" TO capiro_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON "clio_inbound_mail" TO capiro_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON "clio_outbound_mail" TO capiro_app;
  END IF;
END
$$;
