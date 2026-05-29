-- Idempotent re-apply of users.title. The previous migration
-- (20260525151500_user_title) was recorded as rolled back in
-- _prisma_migrations after the first attempt failed with a wrong
-- table name ("user" vs the @@map "users"). Prisma's `migrate deploy`
-- treats rolled-back entries as already-handled and won't retry them,
-- so we ship the ALTER under a new migration name. IF NOT EXISTS
-- makes this safe whether or not the column ended up created.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "title" TEXT;
