-- DropForeignKey
ALTER TABLE "audit_logs" DROP CONSTRAINT "audit_logs_actor_user_id_fkey";

-- DropForeignKey
ALTER TABLE "audit_logs" DROP CONSTRAINT "audit_logs_tenant_id_fkey";

-- DropForeignKey
ALTER TABLE "client_association_overrides" DROP CONSTRAINT "client_association_overrides_client_fkey";

-- DropForeignKey
ALTER TABLE "client_association_overrides" DROP CONSTRAINT "client_association_overrides_previous_client_fkey";

-- DropForeignKey
ALTER TABLE "client_association_overrides" DROP CONSTRAINT "client_association_overrides_tenant_fkey";

-- DropForeignKey
ALTER TABLE "client_association_overrides" DROP CONSTRAINT "client_association_overrides_user_fkey";

-- DropForeignKey
ALTER TABLE "clients" DROP CONSTRAINT "clients_created_by_fkey";

-- DropForeignKey
ALTER TABLE "clients" DROP CONSTRAINT "clients_tenant_id_fkey";

-- DropForeignKey
ALTER TABLE "clio_artifacts" DROP CONSTRAINT "clio_artifacts_client_id_fkey";

-- DropForeignKey
ALTER TABLE "clio_artifacts" DROP CONSTRAINT "clio_artifacts_conversation_id_fkey";

-- DropForeignKey
ALTER TABLE "clio_artifacts" DROP CONSTRAINT "clio_artifacts_message_id_fkey";

-- DropForeignKey
ALTER TABLE "clio_artifacts" DROP CONSTRAINT "clio_artifacts_tenant_id_fkey";

-- DropForeignKey
ALTER TABLE "clio_artifacts" DROP CONSTRAINT "clio_artifacts_user_id_fkey";

-- DropForeignKey
ALTER TABLE "clio_conversations" DROP CONSTRAINT "clio_conversations_client_id_fkey";

-- DropForeignKey
ALTER TABLE "clio_conversations" DROP CONSTRAINT "clio_conversations_tenant_id_fkey";

-- DropForeignKey
ALTER TABLE "clio_conversations" DROP CONSTRAINT "clio_conversations_user_id_fkey";

-- DropForeignKey
ALTER TABLE "clio_messages" DROP CONSTRAINT "clio_messages_client_id_fkey";

-- DropForeignKey
ALTER TABLE "clio_messages" DROP CONSTRAINT "clio_messages_conversation_id_fkey";

-- DropForeignKey
ALTER TABLE "clio_messages" DROP CONSTRAINT "clio_messages_tenant_id_fkey";

-- DropForeignKey
ALTER TABLE "clio_messages" DROP CONSTRAINT "clio_messages_user_id_fkey";

-- DropForeignKey
ALTER TABLE "clio_notes" DROP CONSTRAINT "clio_notes_client_id_fkey";

-- DropForeignKey
ALTER TABLE "clio_notes" DROP CONSTRAINT "clio_notes_conversation_id_fkey";

-- DropForeignKey
ALTER TABLE "clio_notes" DROP CONSTRAINT "clio_notes_meeting_id_fkey";

-- DropForeignKey
ALTER TABLE "clio_notes" DROP CONSTRAINT "clio_notes_tenant_id_fkey";

-- DropForeignKey
ALTER TABLE "clio_notes" DROP CONSTRAINT "clio_notes_user_id_fkey";

-- DropForeignKey
ALTER TABLE "context_embeddings" DROP CONSTRAINT "context_embeddings_client_fkey";

-- DropForeignKey
ALTER TABLE "context_embeddings" DROP CONSTRAINT "context_embeddings_tenant_fkey";

-- DropForeignKey
ALTER TABLE "directory_contact_notes" DROP CONSTRAINT "directory_contact_notes_created_by_fkey";

-- DropForeignKey
ALTER TABLE "directory_contact_notes" DROP CONSTRAINT "directory_contact_notes_tenant_fkey";

-- DropForeignKey
ALTER TABLE "engagement_attachments" DROP CONSTRAINT "engagement_attachments_client_fkey";

-- DropForeignKey
ALTER TABLE "engagement_attachments" DROP CONSTRAINT "engagement_attachments_mail_message_fkey";

-- DropForeignKey
ALTER TABLE "engagement_attachments" DROP CONSTRAINT "engagement_attachments_meeting_fkey";

-- DropForeignKey
ALTER TABLE "engagement_attachments" DROP CONSTRAINT "engagement_attachments_tenant_fkey";

-- DropForeignKey
ALTER TABLE "engagement_attachments" DROP CONSTRAINT "engagement_attachments_uploaded_by_fkey";

-- DropForeignKey
ALTER TABLE "engagement_connection_tokens" DROP CONSTRAINT "engagement_connection_tokens_connection_fkey";

-- DropForeignKey
ALTER TABLE "engagement_connection_tokens" DROP CONSTRAINT "engagement_connection_tokens_tenant_fkey";

-- DropForeignKey
ALTER TABLE "engagement_connections" DROP CONSTRAINT "engagement_connections_created_by_fkey";

-- DropForeignKey
ALTER TABLE "engagement_connections" DROP CONSTRAINT "engagement_connections_tenant_fkey";

-- DropForeignKey
ALTER TABLE "engagement_contacts" DROP CONSTRAINT "engagement_contacts_client_fkey";

-- DropForeignKey
ALTER TABLE "engagement_contacts" DROP CONSTRAINT "engagement_contacts_tenant_fkey";

-- DropForeignKey
ALTER TABLE "engagement_report_target_offices" DROP CONSTRAINT "engagement_report_targets_client_fkey";

-- DropForeignKey
ALTER TABLE "engagement_report_target_offices" DROP CONSTRAINT "engagement_report_targets_created_by_fkey";

-- DropForeignKey
ALTER TABLE "engagement_report_target_offices" DROP CONSTRAINT "engagement_report_targets_tenant_fkey";

-- DropForeignKey
ALTER TABLE "engagement_tasks" DROP CONSTRAINT "engagement_tasks_client_fkey";

-- DropForeignKey
ALTER TABLE "engagement_tasks" DROP CONSTRAINT "engagement_tasks_contact_fkey";

-- DropForeignKey
ALTER TABLE "engagement_tasks" DROP CONSTRAINT "engagement_tasks_created_by_fkey";

-- DropForeignKey
ALTER TABLE "engagement_tasks" DROP CONSTRAINT "engagement_tasks_mail_thread_fkey";

-- DropForeignKey
ALTER TABLE "engagement_tasks" DROP CONSTRAINT "engagement_tasks_meeting_fkey";

-- DropForeignKey
ALTER TABLE "engagement_tasks" DROP CONSTRAINT "engagement_tasks_owner_fkey";

-- DropForeignKey
ALTER TABLE "engagement_tasks" DROP CONSTRAINT "engagement_tasks_tenant_fkey";

-- DropForeignKey
ALTER TABLE "impersonation_sessions" DROP CONSTRAINT "impersonation_sessions_actor_fkey";

-- DropForeignKey
ALTER TABLE "impersonation_sessions" DROP CONSTRAINT "impersonation_sessions_tenant_fkey";

-- DropForeignKey
ALTER TABLE "mail_messages" DROP CONSTRAINT "mail_messages_connection_fkey";

-- DropForeignKey
ALTER TABLE "mail_messages" DROP CONSTRAINT "mail_messages_tenant_fkey";

-- DropForeignKey
ALTER TABLE "mail_messages" DROP CONSTRAINT "mail_messages_thread_fkey";

-- DropForeignKey
ALTER TABLE "mail_threads" DROP CONSTRAINT "mail_threads_client_fkey";

-- DropForeignKey
ALTER TABLE "mail_threads" DROP CONSTRAINT "mail_threads_connection_fkey";

-- DropForeignKey
ALTER TABLE "mail_threads" DROP CONSTRAINT "mail_threads_tenant_fkey";

-- DropForeignKey
ALTER TABLE "meeting_attendees" DROP CONSTRAINT "meeting_attendees_contact_fkey";

-- DropForeignKey
ALTER TABLE "meeting_attendees" DROP CONSTRAINT "meeting_attendees_meeting_fkey";

-- DropForeignKey
ALTER TABLE "meeting_attendees" DROP CONSTRAINT "meeting_attendees_tenant_fkey";

-- DropForeignKey
ALTER TABLE "meeting_debriefs" DROP CONSTRAINT "meeting_debriefs_author_fkey";

-- DropForeignKey
ALTER TABLE "meeting_debriefs" DROP CONSTRAINT "meeting_debriefs_client_fkey";

-- DropForeignKey
ALTER TABLE "meeting_debriefs" DROP CONSTRAINT "meeting_debriefs_meeting_fkey";

-- DropForeignKey
ALTER TABLE "meeting_debriefs" DROP CONSTRAINT "meeting_debriefs_tenant_fkey";

-- DropForeignKey
ALTER TABLE "meeting_notes" DROP CONSTRAINT "meeting_notes_author_fkey";

-- DropForeignKey
ALTER TABLE "meeting_notes" DROP CONSTRAINT "meeting_notes_client_fkey";

-- DropForeignKey
ALTER TABLE "meeting_notes" DROP CONSTRAINT "meeting_notes_meeting_fkey";

-- DropForeignKey
ALTER TABLE "meeting_notes" DROP CONSTRAINT "meeting_notes_tenant_fkey";

-- DropForeignKey
ALTER TABLE "meeting_preps" DROP CONSTRAINT "meeting_preps_client_fkey";

-- DropForeignKey
ALTER TABLE "meeting_preps" DROP CONSTRAINT "meeting_preps_edited_by_fkey";

-- DropForeignKey
ALTER TABLE "meeting_preps" DROP CONSTRAINT "meeting_preps_meeting_fkey";

-- DropForeignKey
ALTER TABLE "meeting_preps" DROP CONSTRAINT "meeting_preps_tenant_fkey";

-- DropForeignKey
ALTER TABLE "meetings" DROP CONSTRAINT "meetings_client_fkey";

-- DropForeignKey
ALTER TABLE "meetings" DROP CONSTRAINT "meetings_connection_fkey";

-- DropForeignKey
ALTER TABLE "meetings" DROP CONSTRAINT "meetings_created_by_fkey";

-- DropForeignKey
ALTER TABLE "meetings" DROP CONSTRAINT "meetings_tenant_fkey";

-- DropForeignKey
ALTER TABLE "outreach_records" DROP CONSTRAINT "outreach_records_client_fkey";

-- DropForeignKey
ALTER TABLE "outreach_records" DROP CONSTRAINT "outreach_records_created_by_fkey";

-- DropForeignKey
ALTER TABLE "outreach_records" DROP CONSTRAINT "outreach_records_meeting_fkey";

-- DropForeignKey
ALTER TABLE "outreach_records" DROP CONSTRAINT "outreach_records_tenant_fkey";

-- DropForeignKey
ALTER TABLE "outreach_templates" DROP CONSTRAINT "outreach_templates_created_by_fkey";

-- DropForeignKey
ALTER TABLE "outreach_templates" DROP CONSTRAINT "outreach_templates_tenant_fkey";

-- DropForeignKey
ALTER TABLE "tenant_memberships" DROP CONSTRAINT "tenant_memberships_tenant_id_fkey";

-- DropForeignKey
ALTER TABLE "tenant_memberships" DROP CONSTRAINT "tenant_memberships_user_id_fkey";

-- DropIndex
DROP INDEX "clio_artifacts_tenant_client_created_idx";

-- DropIndex
DROP INDEX "clio_messages_tenant_client_created_idx";

-- DropIndex
DROP INDEX "directory_contact_notes_tenant_contact_created_idx";

-- DropIndex
DROP INDEX "engagement_attachments_tenant_s3_key";

-- DropIndex
DROP INDEX "mail_threads_subject_trgm_idx";

-- DropIndex
DROP INDEX "meetings_subject_trgm_idx";

-- DropIndex
DROP INDEX "outreach_records_tenant_client_created_idx";

-- DropIndex
DROP INDEX "outreach_records_tenant_deleted_created_idx";

-- DropIndex
DROP INDEX "outreach_records_tenant_type_status_created_idx";

-- DropIndex
DROP INDEX "outreach_templates_tenant_user_type_updated_idx";

-- AlterTable
ALTER TABLE "audit_logs" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "clerk_events" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "client_association_overrides" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "clients" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "clio_artifacts" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "clio_conversations" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "clio_messages" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "clio_notes" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "context_embeddings" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "demo_requests" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "directory_contact_notes" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "engagement_attachments" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "engagement_connection_tokens" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "engagement_connections" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "engagement_contacts" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "engagement_report_target_offices" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "engagement_tasks" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "impersonation_sessions" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "mail_messages" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "mail_threads" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "meeting_attendees" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "meeting_debriefs" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "meeting_notes" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "meeting_preps" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "meetings" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "outreach_records" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "outreach_templates" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "tenant_memberships" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "tenants" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "users" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "workflow_instances" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "workflow_templates" ALTER COLUMN "id" DROP DEFAULT;

-- CreateTable
CREATE TABLE "client_capabilities" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'product',
    "description" TEXT,
    "sector" TEXT,
    "tags_jsonb" JSONB NOT NULL DEFAULT '[]',
    "trl" INTEGER,
    "mrl" INTEGER,
    "pe_number" TEXT,
    "appropriation_account" TEXT,
    "service_branch" TEXT,
    "target_subcommittee" TEXT,
    "funding_ask" INTEGER,
    "funding_ask_label" TEXT,
    "justification" TEXT,
    "district_nexus" TEXT,
    "existing_contracts" TEXT,
    "notes" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "client_capabilities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "client_submission_history" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "capability_id" UUID,
    "fiscal_year" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "meta" TEXT,
    "outcome" TEXT,
    "outcome_type" TEXT NOT NULL DEFAULT 'in_progress',
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "client_submission_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "client_people" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "title" TEXT,
    "email" CITEXT,
    "phone" TEXT,
    "role" TEXT,
    "last_contact" TIMESTAMPTZ(6),
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "client_people_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "client_capabilities_tenant_client_idx" ON "client_capabilities"("tenant_id", "client_id");

-- CreateIndex
CREATE INDEX "client_submission_history_tenant_client_cap_idx" ON "client_submission_history"("tenant_id", "client_id", "capability_id");

-- CreateIndex
CREATE INDEX "client_people_tenant_client_idx" ON "client_people"("tenant_id", "client_id");

-- CreateIndex
CREATE INDEX "directory_contact_notes_tenant_contact_created_idx" ON "directory_contact_notes"("tenant_id", "directory_contact_id", "created_at");

-- CreateIndex
CREATE INDEX "impersonation_sessions_actor_active_idx" ON "impersonation_sessions"("actor_user_id", "expires_at");

-- CreateIndex
CREATE INDEX "outreach_records_tenant_type_status_created_idx" ON "outreach_records"("tenant_id", "type", "status", "created_at");

-- CreateIndex
CREATE INDEX "outreach_records_tenant_client_created_idx" ON "outreach_records"("tenant_id", "client_id", "created_at");

-- CreateIndex
CREATE INDEX "outreach_records_tenant_deleted_created_idx" ON "outreach_records"("tenant_id", "deleted_at", "created_at");

-- CreateIndex
CREATE INDEX "outreach_templates_tenant_user_type_updated_idx" ON "outreach_templates"("tenant_id", "created_by_user_id", "type", "updated_at");

-- AddForeignKey
ALTER TABLE "tenant_memberships" ADD CONSTRAINT "tenant_memberships_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_memberships" ADD CONSTRAINT "tenant_memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clients" ADD CONSTRAINT "clients_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "directory_contact_notes" ADD CONSTRAINT "directory_contact_notes_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "directory_contact_notes" ADD CONSTRAINT "directory_contact_notes_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "engagement_connections" ADD CONSTRAINT "engagement_connections_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "engagement_connection_tokens" ADD CONSTRAINT "engagement_connection_tokens_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "engagement_connection_tokens" ADD CONSTRAINT "engagement_connection_tokens_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "engagement_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "engagement_contacts" ADD CONSTRAINT "engagement_contacts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "engagement_contacts" ADD CONSTRAINT "engagement_contacts_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "engagement_connections"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting_attendees" ADD CONSTRAINT "meeting_attendees_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting_attendees" ADD CONSTRAINT "meeting_attendees_meeting_id_fkey" FOREIGN KEY ("meeting_id") REFERENCES "meetings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting_attendees" ADD CONSTRAINT "meeting_attendees_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "engagement_contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mail_threads" ADD CONSTRAINT "mail_threads_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mail_threads" ADD CONSTRAINT "mail_threads_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mail_threads" ADD CONSTRAINT "mail_threads_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "engagement_connections"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mail_messages" ADD CONSTRAINT "mail_messages_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mail_messages" ADD CONSTRAINT "mail_messages_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "mail_threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mail_messages" ADD CONSTRAINT "mail_messages_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "engagement_connections"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "engagement_attachments" ADD CONSTRAINT "engagement_attachments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "engagement_attachments" ADD CONSTRAINT "engagement_attachments_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "engagement_attachments" ADD CONSTRAINT "engagement_attachments_meeting_id_fkey" FOREIGN KEY ("meeting_id") REFERENCES "meetings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "engagement_attachments" ADD CONSTRAINT "engagement_attachments_mail_message_id_fkey" FOREIGN KEY ("mail_message_id") REFERENCES "mail_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting_notes" ADD CONSTRAINT "meeting_notes_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting_notes" ADD CONSTRAINT "meeting_notes_meeting_id_fkey" FOREIGN KEY ("meeting_id") REFERENCES "meetings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting_notes" ADD CONSTRAINT "meeting_notes_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting_notes" ADD CONSTRAINT "meeting_notes_author_user_id_fkey" FOREIGN KEY ("author_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting_preps" ADD CONSTRAINT "meeting_preps_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting_preps" ADD CONSTRAINT "meeting_preps_meeting_id_fkey" FOREIGN KEY ("meeting_id") REFERENCES "meetings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting_preps" ADD CONSTRAINT "meeting_preps_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting_debriefs" ADD CONSTRAINT "meeting_debriefs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting_debriefs" ADD CONSTRAINT "meeting_debriefs_meeting_id_fkey" FOREIGN KEY ("meeting_id") REFERENCES "meetings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting_debriefs" ADD CONSTRAINT "meeting_debriefs_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting_debriefs" ADD CONSTRAINT "meeting_debriefs_author_user_id_fkey" FOREIGN KEY ("author_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "engagement_tasks" ADD CONSTRAINT "engagement_tasks_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "engagement_tasks" ADD CONSTRAINT "engagement_tasks_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "engagement_tasks" ADD CONSTRAINT "engagement_tasks_meeting_id_fkey" FOREIGN KEY ("meeting_id") REFERENCES "meetings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "engagement_tasks" ADD CONSTRAINT "engagement_tasks_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "engagement_contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "engagement_tasks" ADD CONSTRAINT "engagement_tasks_mail_thread_id_fkey" FOREIGN KEY ("mail_thread_id") REFERENCES "mail_threads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "engagement_report_target_offices" ADD CONSTRAINT "engagement_report_target_offices_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "engagement_report_target_offices" ADD CONSTRAINT "engagement_report_target_offices_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "engagement_report_target_offices" ADD CONSTRAINT "engagement_report_target_offices_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outreach_records" ADD CONSTRAINT "outreach_records_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outreach_records" ADD CONSTRAINT "outreach_records_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outreach_records" ADD CONSTRAINT "outreach_records_meeting_id_fkey" FOREIGN KEY ("meeting_id") REFERENCES "meetings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outreach_records" ADD CONSTRAINT "outreach_records_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outreach_templates" ADD CONSTRAINT "outreach_templates_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outreach_templates" ADD CONSTRAINT "outreach_templates_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_association_overrides" ADD CONSTRAINT "client_association_overrides_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_association_overrides" ADD CONSTRAINT "client_association_overrides_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "context_embeddings" ADD CONSTRAINT "context_embeddings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "impersonation_sessions" ADD CONSTRAINT "impersonation_sessions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "impersonation_sessions" ADD CONSTRAINT "impersonation_sessions_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clio_conversations" ADD CONSTRAINT "clio_conversations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clio_conversations" ADD CONSTRAINT "clio_conversations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clio_conversations" ADD CONSTRAINT "clio_conversations_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clio_messages" ADD CONSTRAINT "clio_messages_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clio_messages" ADD CONSTRAINT "clio_messages_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clio_messages" ADD CONSTRAINT "clio_messages_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clio_messages" ADD CONSTRAINT "clio_messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "clio_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clio_artifacts" ADD CONSTRAINT "clio_artifacts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clio_artifacts" ADD CONSTRAINT "clio_artifacts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clio_artifacts" ADD CONSTRAINT "clio_artifacts_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clio_artifacts" ADD CONSTRAINT "clio_artifacts_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "clio_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clio_artifacts" ADD CONSTRAINT "clio_artifacts_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "clio_messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clio_notes" ADD CONSTRAINT "clio_notes_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clio_notes" ADD CONSTRAINT "clio_notes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clio_notes" ADD CONSTRAINT "clio_notes_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clio_notes" ADD CONSTRAINT "clio_notes_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "clio_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clio_notes" ADD CONSTRAINT "clio_notes_meeting_id_fkey" FOREIGN KEY ("meeting_id") REFERENCES "meetings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_capabilities" ADD CONSTRAINT "client_capabilities_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_capabilities" ADD CONSTRAINT "client_capabilities_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_submission_history" ADD CONSTRAINT "client_submission_history_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_submission_history" ADD CONSTRAINT "client_submission_history_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_submission_history" ADD CONSTRAINT "client_submission_history_capability_id_fkey" FOREIGN KEY ("capability_id") REFERENCES "client_capabilities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_people" ADD CONSTRAINT "client_people_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_people" ADD CONSTRAINT "client_people_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "engagement_connection_tokens_connection_key" RENAME TO "engagement_connection_tokens_connection_id_key";
