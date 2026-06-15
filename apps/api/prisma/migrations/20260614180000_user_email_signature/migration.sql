-- Per-user HTML email signature.
--
-- Adds two columns to the (global, non-tenant-scoped) users table:
--   email_signature_html    — server-sanitized HTML signature (nullable; null =
--                             no signature). Stored already-clean so the send
--                             path appends it without re-stripping.
--   email_signature_enabled — append-by-default preference. Each outreach
--                             campaign can still override at send time.
--
-- The users table carries no RLS policy (it is keyed by Clerk identity, not
-- tenant), so no policy changes are needed — just additive columns.

ALTER TABLE "users" ADD COLUMN "email_signature_html" TEXT;
ALTER TABLE "users" ADD COLUMN "email_signature_enabled" BOOLEAN NOT NULL DEFAULT false;
