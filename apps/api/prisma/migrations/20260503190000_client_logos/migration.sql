ALTER TABLE "clients" ADD COLUMN "logo_s3_key" TEXT;
ALTER TABLE "clients" ADD COLUMN "logo_content_type" TEXT;
ALTER TABLE "clients" ADD COLUMN "logo_uploaded_at" TIMESTAMPTZ(6);
