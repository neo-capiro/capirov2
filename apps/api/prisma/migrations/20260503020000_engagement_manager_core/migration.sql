-- Engagement Manager core.
--
-- This migration adds tenant-scoped normalized models for provider connections,
-- meetings, email threads/messages, attendees, S3-backed attachments,
-- encrypted meeting notes, AI meeting prep, task follow-ups, association
-- overrides, and pgvector-backed context embeddings.

-- ----------------------------------------------------------------------------
-- Enums
-- ----------------------------------------------------------------------------
CREATE TYPE "engagement_provider" AS ENUM (
  'microsoft_365',
  'google_workspace',
  'imap_caldav',
  'manual'
);

CREATE TYPE "engagement_connection_status" AS ENUM (
  'needs_configuration',
  'connected',
  'error',
  'disabled'
);

CREATE TYPE "engagement_source" AS ENUM (
  'outlook',
  'google',
  'imap_caldav',
  'manual'
);

CREATE TYPE "association_entity_type" AS ENUM (
  'meeting',
  'mail_thread',
  'mail_message',
  'contact',
  'task'
);

CREATE TYPE "meeting_prep_status" AS ENUM (
  'generated',
  'edited',
  'stale',
  'failed'
);

CREATE TYPE "engagement_task_status" AS ENUM (
  'todo',
  'in_progress',
  'done',
  'blocked',
  'canceled'
);

-- ----------------------------------------------------------------------------
-- Provider connections and sync cursors
-- ----------------------------------------------------------------------------
CREATE TABLE "engagement_connections" (
  "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
  "tenant_id" UUID NOT NULL,
  "provider" "engagement_provider" NOT NULL,
  "account_email" CITEXT,
  "display_name" TEXT,
  "status" "engagement_connection_status" NOT NULL DEFAULT 'needs_configuration',
  "scopes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "sync_state_jsonb" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "last_sync_at" TIMESTAMPTZ(6),
  "next_sync_at" TIMESTAMPTZ(6),
  "last_error" TEXT,
  "created_by_user_id" UUID,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  CONSTRAINT "engagement_connections_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "engagement_connections_tenant_fkey" FOREIGN KEY ("tenant_id")
    REFERENCES "tenants"("id") ON DELETE CASCADE,
  CONSTRAINT "engagement_connections_created_by_fkey" FOREIGN KEY ("created_by_user_id")
    REFERENCES "users"("id") ON DELETE SET NULL
);

CREATE UNIQUE INDEX "engagement_connections_tenant_provider_account_key"
  ON "engagement_connections" ("tenant_id", "provider", "account_email");
CREATE INDEX "engagement_connections_tenant_status_idx"
  ON "engagement_connections" ("tenant_id", "status");

CREATE TRIGGER "engagement_connections_set_updated_at"
  BEFORE UPDATE ON "engagement_connections"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ----------------------------------------------------------------------------
-- Contacts, meetings, attendees
-- ----------------------------------------------------------------------------
CREATE TABLE "engagement_contacts" (
  "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
  "tenant_id" UUID NOT NULL,
  "client_id" UUID,
  "directory_entry_id" TEXT,
  "full_name" TEXT,
  "email" CITEXT,
  "phone" TEXT,
  "organization" TEXT,
  "title" TEXT,
  "source" TEXT NOT NULL DEFAULT 'manual',
  "metadata_jsonb" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  CONSTRAINT "engagement_contacts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "engagement_contacts_tenant_fkey" FOREIGN KEY ("tenant_id")
    REFERENCES "tenants"("id") ON DELETE CASCADE,
  CONSTRAINT "engagement_contacts_client_fkey" FOREIGN KEY ("client_id")
    REFERENCES "clients"("id") ON DELETE SET NULL
);

CREATE UNIQUE INDEX "engagement_contacts_tenant_email_key"
  ON "engagement_contacts" ("tenant_id", "email");
CREATE INDEX "engagement_contacts_tenant_client_idx"
  ON "engagement_contacts" ("tenant_id", "client_id");

CREATE TRIGGER "engagement_contacts_set_updated_at"
  BEFORE UPDATE ON "engagement_contacts"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE "meetings" (
  "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
  "tenant_id" UUID NOT NULL,
  "client_id" UUID,
  "connection_id" UUID,
  "source" "engagement_source" NOT NULL DEFAULT 'manual',
  "external_id" TEXT,
  "subject" TEXT NOT NULL,
  "description" TEXT,
  "location" TEXT,
  "starts_at" TIMESTAMPTZ(6) NOT NULL,
  "ends_at" TIMESTAMPTZ(6) NOT NULL,
  "organizer_email" CITEXT,
  "organizer_name" TEXT,
  "status" TEXT NOT NULL DEFAULT 'scheduled',
  "transcript_s3_key" TEXT,
  "metadata_jsonb" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "raw_jsonb" JSONB,
  "association_score" DOUBLE PRECISION,
  "association_reason" TEXT,
  "association_signals_jsonb" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "created_by_user_id" UUID,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  CONSTRAINT "meetings_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "meetings_tenant_fkey" FOREIGN KEY ("tenant_id")
    REFERENCES "tenants"("id") ON DELETE CASCADE,
  CONSTRAINT "meetings_client_fkey" FOREIGN KEY ("client_id")
    REFERENCES "clients"("id") ON DELETE SET NULL,
  CONSTRAINT "meetings_connection_fkey" FOREIGN KEY ("connection_id")
    REFERENCES "engagement_connections"("id") ON DELETE SET NULL,
  CONSTRAINT "meetings_created_by_fkey" FOREIGN KEY ("created_by_user_id")
    REFERENCES "users"("id") ON DELETE SET NULL,
  CONSTRAINT "meetings_time_order_check" CHECK ("ends_at" >= "starts_at")
);

CREATE UNIQUE INDEX "meetings_tenant_source_external_key"
  ON "meetings" ("tenant_id", "source", "external_id");
CREATE INDEX "meetings_tenant_starts_idx" ON "meetings" ("tenant_id", "starts_at");
CREATE INDEX "meetings_tenant_client_starts_idx"
  ON "meetings" ("tenant_id", "client_id", "starts_at");
CREATE INDEX "meetings_subject_trgm_idx"
  ON "meetings" USING GIN ("subject" gin_trgm_ops);

CREATE TRIGGER "meetings_set_updated_at"
  BEFORE UPDATE ON "meetings"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE "meeting_attendees" (
  "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
  "tenant_id" UUID NOT NULL,
  "meeting_id" UUID NOT NULL,
  "contact_id" UUID,
  "email" CITEXT,
  "name" TEXT,
  "role" TEXT,
  "response_status" TEXT,
  "metadata_jsonb" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  CONSTRAINT "meeting_attendees_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "meeting_attendees_tenant_fkey" FOREIGN KEY ("tenant_id")
    REFERENCES "tenants"("id") ON DELETE CASCADE,
  CONSTRAINT "meeting_attendees_meeting_fkey" FOREIGN KEY ("meeting_id")
    REFERENCES "meetings"("id") ON DELETE CASCADE,
  CONSTRAINT "meeting_attendees_contact_fkey" FOREIGN KEY ("contact_id")
    REFERENCES "engagement_contacts"("id") ON DELETE SET NULL
);

CREATE UNIQUE INDEX "meeting_attendees_meeting_email_key"
  ON "meeting_attendees" ("meeting_id", "email");
CREATE INDEX "meeting_attendees_tenant_email_idx"
  ON "meeting_attendees" ("tenant_id", "email");

-- ----------------------------------------------------------------------------
-- Mail threads and normalized messages
-- ----------------------------------------------------------------------------
CREATE TABLE "mail_threads" (
  "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
  "tenant_id" UUID NOT NULL,
  "client_id" UUID,
  "connection_id" UUID,
  "source" "engagement_source" NOT NULL DEFAULT 'manual',
  "external_id" TEXT,
  "subject" TEXT NOT NULL,
  "snippet" TEXT,
  "participants_jsonb" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "last_message_at" TIMESTAMPTZ(6),
  "status" TEXT NOT NULL DEFAULT 'open',
  "metadata_jsonb" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "raw_jsonb" JSONB,
  "association_score" DOUBLE PRECISION,
  "association_reason" TEXT,
  "association_signals_jsonb" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  CONSTRAINT "mail_threads_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "mail_threads_tenant_fkey" FOREIGN KEY ("tenant_id")
    REFERENCES "tenants"("id") ON DELETE CASCADE,
  CONSTRAINT "mail_threads_client_fkey" FOREIGN KEY ("client_id")
    REFERENCES "clients"("id") ON DELETE SET NULL,
  CONSTRAINT "mail_threads_connection_fkey" FOREIGN KEY ("connection_id")
    REFERENCES "engagement_connections"("id") ON DELETE SET NULL
);

CREATE UNIQUE INDEX "mail_threads_tenant_source_external_key"
  ON "mail_threads" ("tenant_id", "source", "external_id");
CREATE INDEX "mail_threads_tenant_client_last_idx"
  ON "mail_threads" ("tenant_id", "client_id", "last_message_at");
CREATE INDEX "mail_threads_subject_trgm_idx"
  ON "mail_threads" USING GIN ("subject" gin_trgm_ops);

CREATE TRIGGER "mail_threads_set_updated_at"
  BEFORE UPDATE ON "mail_threads"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE "mail_messages" (
  "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
  "tenant_id" UUID NOT NULL,
  "thread_id" UUID NOT NULL,
  "connection_id" UUID,
  "source" "engagement_source" NOT NULL DEFAULT 'manual',
  "external_id" TEXT,
  "subject" TEXT,
  "from_email" CITEXT,
  "from_name" TEXT,
  "to_recipients_jsonb" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "cc_recipients_jsonb" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "bcc_recipients_jsonb" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "sent_at" TIMESTAMPTZ(6),
  "received_at" TIMESTAMPTZ(6),
  "body_text" TEXT,
  "body_html_s3_key" TEXT,
  "has_attachments" BOOLEAN NOT NULL DEFAULT false,
  "metadata_jsonb" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "raw_jsonb" JSONB,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  CONSTRAINT "mail_messages_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "mail_messages_tenant_fkey" FOREIGN KEY ("tenant_id")
    REFERENCES "tenants"("id") ON DELETE CASCADE,
  CONSTRAINT "mail_messages_thread_fkey" FOREIGN KEY ("thread_id")
    REFERENCES "mail_threads"("id") ON DELETE CASCADE,
  CONSTRAINT "mail_messages_connection_fkey" FOREIGN KEY ("connection_id")
    REFERENCES "engagement_connections"("id") ON DELETE SET NULL
);

CREATE UNIQUE INDEX "mail_messages_tenant_source_external_key"
  ON "mail_messages" ("tenant_id", "source", "external_id");
CREATE INDEX "mail_messages_tenant_from_idx"
  ON "mail_messages" ("tenant_id", "from_email");
CREATE INDEX "mail_messages_tenant_received_idx"
  ON "mail_messages" ("tenant_id", "received_at");

CREATE TRIGGER "mail_messages_set_updated_at"
  BEFORE UPDATE ON "mail_messages"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ----------------------------------------------------------------------------
-- S3-backed attachments
-- ----------------------------------------------------------------------------
CREATE TABLE "engagement_attachments" (
  "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
  "tenant_id" UUID NOT NULL,
  "client_id" UUID,
  "meeting_id" UUID,
  "mail_message_id" UUID,
  "file_name" TEXT NOT NULL,
  "content_type" TEXT NOT NULL,
  "byte_size" INTEGER,
  "bucket" TEXT NOT NULL,
  "s3_key" TEXT NOT NULL,
  "checksum_sha256" TEXT,
  "source" TEXT NOT NULL DEFAULT 'manual',
  "uploaded_by_user_id" UUID,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  CONSTRAINT "engagement_attachments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "engagement_attachments_tenant_fkey" FOREIGN KEY ("tenant_id")
    REFERENCES "tenants"("id") ON DELETE CASCADE,
  CONSTRAINT "engagement_attachments_client_fkey" FOREIGN KEY ("client_id")
    REFERENCES "clients"("id") ON DELETE SET NULL,
  CONSTRAINT "engagement_attachments_meeting_fkey" FOREIGN KEY ("meeting_id")
    REFERENCES "meetings"("id") ON DELETE CASCADE,
  CONSTRAINT "engagement_attachments_mail_message_fkey" FOREIGN KEY ("mail_message_id")
    REFERENCES "mail_messages"("id") ON DELETE CASCADE,
  CONSTRAINT "engagement_attachments_uploaded_by_fkey" FOREIGN KEY ("uploaded_by_user_id")
    REFERENCES "users"("id") ON DELETE SET NULL,
  CONSTRAINT "engagement_attachments_parent_check" CHECK (
    "client_id" IS NOT NULL OR "meeting_id" IS NOT NULL OR "mail_message_id" IS NOT NULL
  )
);

CREATE UNIQUE INDEX "engagement_attachments_tenant_s3_key"
  ON "engagement_attachments" ("tenant_id", "s3_key");
CREATE INDEX "engagement_attachments_tenant_client_idx"
  ON "engagement_attachments" ("tenant_id", "client_id");
CREATE INDEX "engagement_attachments_tenant_meeting_idx"
  ON "engagement_attachments" ("tenant_id", "meeting_id");
CREATE INDEX "engagement_attachments_tenant_mail_message_idx"
  ON "engagement_attachments" ("tenant_id", "mail_message_id");

-- ----------------------------------------------------------------------------
-- Encrypted notes and AI prep
-- ----------------------------------------------------------------------------
CREATE TABLE "meeting_notes" (
  "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
  "tenant_id" UUID NOT NULL,
  "meeting_id" UUID NOT NULL,
  "client_id" UUID,
  "author_user_id" UUID,
  "body_ciphertext" TEXT NOT NULL,
  "iv" TEXT NOT NULL,
  "auth_tag" TEXT NOT NULL,
  "key_version" TEXT,
  "confidential" BOOLEAN NOT NULL DEFAULT true,
  "access_level" TEXT NOT NULL DEFAULT 'tenant_admins_and_author',
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  CONSTRAINT "meeting_notes_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "meeting_notes_tenant_fkey" FOREIGN KEY ("tenant_id")
    REFERENCES "tenants"("id") ON DELETE CASCADE,
  CONSTRAINT "meeting_notes_meeting_fkey" FOREIGN KEY ("meeting_id")
    REFERENCES "meetings"("id") ON DELETE CASCADE,
  CONSTRAINT "meeting_notes_client_fkey" FOREIGN KEY ("client_id")
    REFERENCES "clients"("id") ON DELETE SET NULL,
  CONSTRAINT "meeting_notes_author_fkey" FOREIGN KEY ("author_user_id")
    REFERENCES "users"("id") ON DELETE SET NULL
);

CREATE INDEX "meeting_notes_tenant_meeting_created_idx"
  ON "meeting_notes" ("tenant_id", "meeting_id", "created_at");

CREATE TRIGGER "meeting_notes_set_updated_at"
  BEFORE UPDATE ON "meeting_notes"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE "meeting_preps" (
  "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
  "tenant_id" UUID NOT NULL,
  "meeting_id" UUID NOT NULL,
  "client_id" UUID,
  "status" "meeting_prep_status" NOT NULL DEFAULT 'generated',
  "agenda_jsonb" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "talking_points_jsonb" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "risks_jsonb" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "follow_ups_jsonb" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "summary" TEXT,
  "provider" TEXT,
  "model" TEXT,
  "prompt_hash" TEXT,
  "generated_from_jsonb" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "edited_by_user_id" UUID,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  CONSTRAINT "meeting_preps_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "meeting_preps_tenant_fkey" FOREIGN KEY ("tenant_id")
    REFERENCES "tenants"("id") ON DELETE CASCADE,
  CONSTRAINT "meeting_preps_meeting_fkey" FOREIGN KEY ("meeting_id")
    REFERENCES "meetings"("id") ON DELETE CASCADE,
  CONSTRAINT "meeting_preps_client_fkey" FOREIGN KEY ("client_id")
    REFERENCES "clients"("id") ON DELETE SET NULL,
  CONSTRAINT "meeting_preps_edited_by_fkey" FOREIGN KEY ("edited_by_user_id")
    REFERENCES "users"("id") ON DELETE SET NULL
);

CREATE INDEX "meeting_preps_tenant_meeting_created_idx"
  ON "meeting_preps" ("tenant_id", "meeting_id", "created_at");

CREATE TRIGGER "meeting_preps_set_updated_at"
  BEFORE UPDATE ON "meeting_preps"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ----------------------------------------------------------------------------
-- Follow-up tasks and association feedback
-- ----------------------------------------------------------------------------
CREATE TABLE "engagement_tasks" (
  "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
  "tenant_id" UUID NOT NULL,
  "client_id" UUID,
  "meeting_id" UUID,
  "contact_id" UUID,
  "mail_thread_id" UUID,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "owner_user_id" UUID,
  "due_date" DATE,
  "status" "engagement_task_status" NOT NULL DEFAULT 'todo',
  "source_type" TEXT,
  "source_id" TEXT,
  "created_by_user_id" UUID,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  CONSTRAINT "engagement_tasks_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "engagement_tasks_tenant_fkey" FOREIGN KEY ("tenant_id")
    REFERENCES "tenants"("id") ON DELETE CASCADE,
  CONSTRAINT "engagement_tasks_client_fkey" FOREIGN KEY ("client_id")
    REFERENCES "clients"("id") ON DELETE SET NULL,
  CONSTRAINT "engagement_tasks_meeting_fkey" FOREIGN KEY ("meeting_id")
    REFERENCES "meetings"("id") ON DELETE SET NULL,
  CONSTRAINT "engagement_tasks_contact_fkey" FOREIGN KEY ("contact_id")
    REFERENCES "engagement_contacts"("id") ON DELETE SET NULL,
  CONSTRAINT "engagement_tasks_mail_thread_fkey" FOREIGN KEY ("mail_thread_id")
    REFERENCES "mail_threads"("id") ON DELETE SET NULL,
  CONSTRAINT "engagement_tasks_owner_fkey" FOREIGN KEY ("owner_user_id")
    REFERENCES "users"("id") ON DELETE SET NULL,
  CONSTRAINT "engagement_tasks_created_by_fkey" FOREIGN KEY ("created_by_user_id")
    REFERENCES "users"("id") ON DELETE SET NULL
);

CREATE INDEX "engagement_tasks_tenant_client_status_idx"
  ON "engagement_tasks" ("tenant_id", "client_id", "status");
CREATE INDEX "engagement_tasks_tenant_due_idx"
  ON "engagement_tasks" ("tenant_id", "due_date");

CREATE TRIGGER "engagement_tasks_set_updated_at"
  BEFORE UPDATE ON "engagement_tasks"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE "client_association_overrides" (
  "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
  "tenant_id" UUID NOT NULL,
  "entity_type" "association_entity_type" NOT NULL,
  "entity_id" UUID NOT NULL,
  "client_id" UUID NOT NULL,
  "previous_client_id" UUID,
  "confidence_before" DOUBLE PRECISION,
  "reason" TEXT,
  "user_id" UUID,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  CONSTRAINT "client_association_overrides_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "client_association_overrides_tenant_fkey" FOREIGN KEY ("tenant_id")
    REFERENCES "tenants"("id") ON DELETE CASCADE,
  CONSTRAINT "client_association_overrides_client_fkey" FOREIGN KEY ("client_id")
    REFERENCES "clients"("id") ON DELETE CASCADE,
  CONSTRAINT "client_association_overrides_previous_client_fkey" FOREIGN KEY ("previous_client_id")
    REFERENCES "clients"("id") ON DELETE SET NULL,
  CONSTRAINT "client_association_overrides_user_fkey" FOREIGN KEY ("user_id")
    REFERENCES "users"("id") ON DELETE SET NULL
);

CREATE INDEX "association_overrides_entity_idx"
  ON "client_association_overrides" ("tenant_id", "entity_type", "entity_id");
CREATE INDEX "association_overrides_client_created_idx"
  ON "client_association_overrides" ("tenant_id", "client_id", "created_at");

-- ----------------------------------------------------------------------------
-- RAG source chunks. Embeddings are written by the API through raw SQL once an
-- embedding provider is configured.
-- ----------------------------------------------------------------------------
CREATE TABLE "context_embeddings" (
  "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
  "tenant_id" UUID NOT NULL,
  "client_id" UUID,
  "source_type" TEXT NOT NULL,
  "source_id" TEXT NOT NULL,
  "content_text" TEXT NOT NULL,
  "embedding" vector(1536),
  "metadata_jsonb" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  CONSTRAINT "context_embeddings_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "context_embeddings_tenant_fkey" FOREIGN KEY ("tenant_id")
    REFERENCES "tenants"("id") ON DELETE CASCADE,
  CONSTRAINT "context_embeddings_client_fkey" FOREIGN KEY ("client_id")
    REFERENCES "clients"("id") ON DELETE SET NULL
);

CREATE INDEX "context_embeddings_tenant_client_idx"
  ON "context_embeddings" ("tenant_id", "client_id");
CREATE INDEX "context_embeddings_embedding_idx"
  ON "context_embeddings" USING ivfflat ("embedding" vector_cosine_ops)
  WITH (lists = 100)
  WHERE "embedding" IS NOT NULL;

-- ----------------------------------------------------------------------------
-- Row-Level Security
-- ----------------------------------------------------------------------------
ALTER TABLE "engagement_connections" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "engagement_connections" FORCE ROW LEVEL SECURITY;
CREATE POLICY "engagement_connections_isolation" ON "engagement_connections"
  USING (rls_bypass() OR tenant_id = current_tenant_id())
  WITH CHECK (rls_bypass() OR tenant_id = current_tenant_id());

ALTER TABLE "engagement_contacts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "engagement_contacts" FORCE ROW LEVEL SECURITY;
CREATE POLICY "engagement_contacts_isolation" ON "engagement_contacts"
  USING (rls_bypass() OR tenant_id = current_tenant_id())
  WITH CHECK (rls_bypass() OR tenant_id = current_tenant_id());

ALTER TABLE "meetings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "meetings" FORCE ROW LEVEL SECURITY;
CREATE POLICY "meetings_isolation" ON "meetings"
  USING (rls_bypass() OR tenant_id = current_tenant_id())
  WITH CHECK (rls_bypass() OR tenant_id = current_tenant_id());

ALTER TABLE "meeting_attendees" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "meeting_attendees" FORCE ROW LEVEL SECURITY;
CREATE POLICY "meeting_attendees_isolation" ON "meeting_attendees"
  USING (rls_bypass() OR tenant_id = current_tenant_id())
  WITH CHECK (rls_bypass() OR tenant_id = current_tenant_id());

ALTER TABLE "mail_threads" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mail_threads" FORCE ROW LEVEL SECURITY;
CREATE POLICY "mail_threads_isolation" ON "mail_threads"
  USING (rls_bypass() OR tenant_id = current_tenant_id())
  WITH CHECK (rls_bypass() OR tenant_id = current_tenant_id());

ALTER TABLE "mail_messages" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mail_messages" FORCE ROW LEVEL SECURITY;
CREATE POLICY "mail_messages_isolation" ON "mail_messages"
  USING (rls_bypass() OR tenant_id = current_tenant_id())
  WITH CHECK (rls_bypass() OR tenant_id = current_tenant_id());

ALTER TABLE "engagement_attachments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "engagement_attachments" FORCE ROW LEVEL SECURITY;
CREATE POLICY "engagement_attachments_isolation" ON "engagement_attachments"
  USING (rls_bypass() OR tenant_id = current_tenant_id())
  WITH CHECK (rls_bypass() OR tenant_id = current_tenant_id());

ALTER TABLE "meeting_notes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "meeting_notes" FORCE ROW LEVEL SECURITY;
CREATE POLICY "meeting_notes_isolation" ON "meeting_notes"
  USING (rls_bypass() OR tenant_id = current_tenant_id())
  WITH CHECK (rls_bypass() OR tenant_id = current_tenant_id());

ALTER TABLE "meeting_preps" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "meeting_preps" FORCE ROW LEVEL SECURITY;
CREATE POLICY "meeting_preps_isolation" ON "meeting_preps"
  USING (rls_bypass() OR tenant_id = current_tenant_id())
  WITH CHECK (rls_bypass() OR tenant_id = current_tenant_id());

ALTER TABLE "engagement_tasks" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "engagement_tasks" FORCE ROW LEVEL SECURITY;
CREATE POLICY "engagement_tasks_isolation" ON "engagement_tasks"
  USING (rls_bypass() OR tenant_id = current_tenant_id())
  WITH CHECK (rls_bypass() OR tenant_id = current_tenant_id());

ALTER TABLE "client_association_overrides" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "client_association_overrides" FORCE ROW LEVEL SECURITY;
CREATE POLICY "client_association_overrides_isolation" ON "client_association_overrides"
  USING (rls_bypass() OR tenant_id = current_tenant_id())
  WITH CHECK (rls_bypass() OR tenant_id = current_tenant_id());

ALTER TABLE "context_embeddings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "context_embeddings" FORCE ROW LEVEL SECURITY;
CREATE POLICY "context_embeddings_isolation" ON "context_embeddings"
  USING (rls_bypass() OR tenant_id = current_tenant_id())
  WITH CHECK (rls_bypass() OR tenant_id = current_tenant_id());

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'capiro_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON
      "engagement_connections",
      "engagement_contacts",
      "meetings",
      "meeting_attendees",
      "mail_threads",
      "mail_messages",
      "engagement_attachments",
      "meeting_notes",
      "meeting_preps",
      "engagement_tasks",
      "client_association_overrides",
      "context_embeddings"
    TO capiro_app;
  END IF;
END
$$;
