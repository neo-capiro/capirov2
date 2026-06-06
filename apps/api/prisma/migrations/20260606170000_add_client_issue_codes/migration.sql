-- Client-level manual LDA issue-code override (client summary settings).
-- Unioned with the auto codes from the confirmed LDA match in getTrackedBills.
ALTER TABLE "clients" ADD COLUMN "issue_codes" TEXT[] NOT NULL DEFAULT '{}';
