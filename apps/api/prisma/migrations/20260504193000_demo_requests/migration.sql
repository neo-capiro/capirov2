CREATE TABLE "demo_requests" (
  "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
  "name" TEXT NOT NULL,
  "email" CITEXT NOT NULL,
  "company" TEXT NOT NULL,
  "role" TEXT,
  "message" TEXT,
  "source" TEXT,
  "status" TEXT NOT NULL DEFAULT 'new',
  "ip" TEXT,
  "user_agent" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  CONSTRAINT "demo_requests_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "demo_requests_created_idx"
  ON "demo_requests" ("created_at" DESC);

CREATE INDEX "demo_requests_email_created_idx"
  ON "demo_requests" ("email", "created_at" DESC);

CREATE TRIGGER "demo_requests_set_updated_at"
  BEFORE UPDATE ON "demo_requests"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'capiro_app') THEN
    GRANT SELECT, INSERT, UPDATE ON "demo_requests" TO capiro_app;
  END IF;
END $$;
