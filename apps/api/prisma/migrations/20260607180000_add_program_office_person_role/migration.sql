-- Step (plan §8/§14) — Org/person modeling spine: program offices, person roles, and
-- office->program links. People hang off OFFICES and ROLES, never directly off PEs.
-- person_role carries a compliance classification (contact_use) + review gate, replacing
-- the free-text person->PE shortcut. All three tables are GLOBAL reference data (no
-- tenant_id / RLS), same as program / acquisition_personnel / program_element.
--
-- Purely additive: no existing rows are written or altered. acquisition_personnel.pe_primary
-- and program_element_person_candidate are left as-is; the role graph is the new source of
-- truth for person<->office<->program relationships going forward.

-- ── program_office (PEO / PM shop / CPE / contracting office; time-versioned) ──
CREATE TABLE "program_office" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "office_type" VARCHAR(24) NOT NULL,
    "service" VARCHAR(8),
    "parent_office_id" UUID,
    "source_url" TEXT,
    "status" VARCHAR(16) NOT NULL DEFAULT 'active',
    "valid_from" TIMESTAMPTZ(6),
    "valid_to" TIMESTAMPTZ(6),
    "metadata_jsonb" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "program_office_pkey" PRIMARY KEY ("id")
);

-- Unique on (name, service, coalesce(valid_from,'-infinity')). Postgres treats NULLs as
-- distinct, so a functional unique index over coalesce() is required to make a
-- null-valid_from office idempotent for upserts (Prisma cannot express this).
CREATE UNIQUE INDEX "program_office_name_service_valid_from_key"
    ON "program_office" ("name", "service", (COALESCE("valid_from", '-infinity'::timestamptz)));
CREATE INDEX "program_office_service_idx" ON "program_office" ("service");
CREATE INDEX "program_office_office_type_idx" ON "program_office" ("office_type");
CREATE INDEX "program_office_parent_idx" ON "program_office" ("parent_office_id");

ALTER TABLE "program_office"
    ADD CONSTRAINT "program_office_parent_office_id_fkey"
    FOREIGN KEY ("parent_office_id") REFERENCES "program_office"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ── person_role (person @ office and/or program, with contact-use classification) ─
CREATE TABLE "person_role" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "person_id" UUID NOT NULL,
    "office_id" UUID,
    "program_id" UUID,
    "role_title" TEXT NOT NULL,
    "role_type" VARCHAR(24) NOT NULL,
    "source" VARCHAR(64) NOT NULL,
    "source_url" TEXT,
    "source_quote" TEXT,
    "observed_at" TIMESTAMPTZ(6) NOT NULL,
    "effective_start" TIMESTAMPTZ(6),
    "effective_end" TIMESTAMPTZ(6),
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "review_status" VARCHAR(20) NOT NULL DEFAULT 'candidate',
    "contact_use" VARCHAR(40) NOT NULL,
    "stale_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "person_role_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "person_role_person_id_idx" ON "person_role" ("person_id");
CREATE INDEX "person_role_office_id_idx" ON "person_role" ("office_id");
CREATE INDEX "person_role_program_id_idx" ON "person_role" ("program_id");
CREATE INDEX "person_role_review_status_idx" ON "person_role" ("review_status");
CREATE INDEX "person_role_contact_use_idx" ON "person_role" ("contact_use");

ALTER TABLE "person_role"
    ADD CONSTRAINT "person_role_person_id_fkey"
    FOREIGN KEY ("person_id") REFERENCES "acquisition_personnel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "person_role"
    ADD CONSTRAINT "person_role_office_id_fkey"
    FOREIGN KEY ("office_id") REFERENCES "program_office"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "person_role"
    ADD CONSTRAINT "person_role_program_id_fkey"
    FOREIGN KEY ("program_id") REFERENCES "program"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ── program_office_program_link (office -> program; review-gated) ─────────────
CREATE TABLE "program_office_program_link" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "office_id" UUID NOT NULL,
    "program_id" UUID NOT NULL,
    "relation" VARCHAR(16) NOT NULL,
    "source_url" TEXT,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "review_status" VARCHAR(20) NOT NULL DEFAULT 'candidate',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "program_office_program_link_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "program_office_program_link_office_program_key"
    ON "program_office_program_link" ("office_id", "program_id");
CREATE INDEX "program_office_program_link_program_id_idx" ON "program_office_program_link" ("program_id");

ALTER TABLE "program_office_program_link"
    ADD CONSTRAINT "program_office_program_link_office_id_fkey"
    FOREIGN KEY ("office_id") REFERENCES "program_office"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "program_office_program_link"
    ADD CONSTRAINT "program_office_program_link_program_id_fkey"
    FOREIGN KEY ("program_id") REFERENCES "program"("id") ON DELETE CASCADE ON UPDATE CASCADE;
