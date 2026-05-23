-- ─────────────────────────────────────────────────────────────────────────
-- Drop legacy OpenLobby tables
--
-- Phase A consolidation (migration 20260522210000) introduced
-- lobby_intel_mv + lobby_issue_ref_v as LDA-derived replacements for
-- the openlobby.us-sourced lobby_intel + lobby_issue_ref tables.
--
-- The runtime API has been verified reading from the new source
-- (LobbyIntelService source = lda confirmed in prod logs at 04:23 UTC
-- on 2026-05-23). With parity established, we drop the legacy tables.
--
-- KEPT: lobby_trending_topics — still serves trending word data from
-- the openlobby.us text-analysis.json source. The LDA-derived trending
-- sync (sync-lobby-trending.ts) needs a richer text-extraction
-- approach before it can replace this table; deferred to Phase B.
-- ─────────────────────────────────────────────────────────────────────────

DROP TABLE IF EXISTS lobby_intel       CASCADE;
DROP TABLE IF EXISTS lobby_issue_ref   CASCADE;
