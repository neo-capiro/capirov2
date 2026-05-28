CREATE TABLE "program_element_watch" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "pe_code" VARCHAR(8) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "program_element_watch_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "program_element_watch_user_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "program_element_watch_tenant_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "program_element_watch_pe_code_fkey" FOREIGN KEY ("pe_code") REFERENCES "program_element"("pe_code") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "program_element_watch_user_pe_code_key" ON "program_element_watch"("user_id", "pe_code");
CREATE INDEX "program_element_watch_tenant_pe_code_idx" ON "program_element_watch"("tenant_id", "pe_code");
