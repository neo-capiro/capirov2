-- Add an explicit "internal" flag to meetings so users can mark a meeting as
-- internal (not belonging to any client) from the meeting detail client dropdown.
-- Kept as a dedicated column (not metadata_jsonb) because the Outlook sync
-- overwrites metadata on every refresh; isInternal lives outside that write so
-- the flag survives re-sync, and the association logic skips auto-linking when set.
ALTER TABLE "meetings" ADD COLUMN "is_internal" BOOLEAN NOT NULL DEFAULT false;
