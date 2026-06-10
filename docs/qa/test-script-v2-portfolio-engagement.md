# Capiro Test Script v2 — Portfolio & Engagement (source of truth: `main`)

Reflects changes merged to `main` as of commit 67a5dff. This is an INCREMENTAL
script focused on what changed recently; the broader plan lives in
`test-plan-portfolio-dashboard-engagement.md`.

Changes on main covered here:
- Security: forced RLS on client_capabilities + client_intel_mapping (SOC 2);
  cross-tenant IDOR fix on the intelligence mapping endpoints.
- Engagement: outreach draft RESUME in the v2 wizard (4d12866); outreach
  last_step CHECK widened 1..5 → 1..7 (67a5dff, the save-on-step-6/7 fix).
- Portfolio/PE: SAM.gov opportunities ingestion + PE "Procurement activity"
  panel (b1df664/c2ea5b2); action-card "Generate artifact" menu + viewer.

Environment: capiro-dev (= live prod, app.capiro.ai). Use ≥2 tenants for the
isolation tests (capiro-internal + c2-strategies). Verify in the RIGHT tenant.
Legend: [P0]=blocker [P1]=major [P2]=polish. (R)=regression. Verify END-TO-END
RENDER + clean DevTools Console/Network, not just HTTP 200.

NOTE — feature NOT on main yet (do NOT test here): the registrant-anchored
client→LDA association / "import your clients" / Client.ldaClientIds work is on
the `feat/client-data-association` branch, UNMERGED. Its multi-LDA-mapping ROI
roll-up and firm-onboarding endpoints are out of scope until merged.

================================================================================
A. PORTFOLIO — TENANT ISOLATION & SECURITY (the big change)
================================================================================
Setup: Tenant A user (e.g. capiro-internal) and Tenant B user (e.g.
c2-strategies). Grab a clientId and a mappingId that belong to Tenant B (from
B's own session / DB), then attempt cross-tenant access as Tenant A.

--- A.1 IDOR on intelligence mapping endpoints (R, P0) ---
[P0] GET /api/intelligence/mappings/:clientId
  - As Tenant A with A's own clientId → 200, returns A's mappings.
  - As Tenant A with TENANT B's clientId → 404 (NOT 200, NOT B's data).
    (Regression: previously any authed user could read another tenant's
    intel-source mappings by supplying the foreign clientId.)
[P0] PATCH /api/intelligence/mappings/:mappingId  { confirmed: true|false }
  - As Tenant A on A's own mappingId → 200, flips confirmed.
  - As Tenant A on TENANT B's mappingId → 404, and B's mapping `confirmed`
    flag is UNCHANGED (verify in B). No existence leak (404, not 403).
[P1] Confirm the legit UI path is unaffected: in each tenant, Manage Sources
  (/settings/intelligence-mappings) loads its own mappings and confirm/unconfirm
  works normally.
[P1] Repeat the cross-tenant probe for the sibling mapping endpoints to confirm
  the same ownership pattern holds:
  - POST /api/intelligence/mappings/:clientId/resolve
  - POST /api/intelligence/mappings/:clientId/manual
  - GET  /api/intelligence/clients/:clientId/* (profile-v1, lobbying-roi,
    fec-money-flow, competitor-board, ex-staffers, bills, tracked-bills,
    health-score, setup-completeness, report-card) — foreign clientId must not
    return data.

--- A.2 Forced RLS on client_capabilities + client_intel_mapping (P0) ---
[P0] A context-less / wrong-tenant DB read of these tables returns 0 rows
  (RLS now FORCED, incl. for the table owner). A correctly tenant-scoped read
  (the app via withTenant) returns the rows. (DB-level check, not just UI.)
[P1] Capabilities CRUD still works in-tenant: add/edit/delete a capability on a
  client → persists and renders. No cross-tenant capability is ever visible.
[P1] Cross-tenant negative: Tenant A cannot read/modify Tenant B's capabilities
  or mappings via any endpoint or id substitution.
[P2] Regression sweep: profile-v1 still loads (the RLS force + IDOR threading
  touched intelligence.service.ts); no source silently fails with a new
  "permission denied" / "Unable to start a transaction" in CloudWatch.

--- A.3 Portfolio core still intact after the refactor (R) ---
[P1] Client list loads; client profile (intelligence-v1) renders all sections.
[P1] Top Alerts worklist still merges its sources and per-user dismiss/snooze/
  ack state still persists.
[P1] Lobbying ROI / Financial Footprint / District Nexus / FEC panels render;
  empty states are by-design where no confirmed mapping/data exists.
[P1] Tenant isolation end-to-end: nothing from Tenant B appears in Tenant A
  anywhere on the portfolio surface.

================================================================================
B. PORTFOLIO / PROGRAM ELEMENTS — SAM.gov + Procurement panel (new)
================================================================================
[P1] PE detail page → "Procurement activity" panel renders for a PE that has
  matched SAM.gov opportunities.
[P1] GET /api/program-elements/:peCode/opportunities returns opportunities for a
  PE with structural matches; empty (panel shows empty state) for a PE with none
  — empty is EXPECTED, not a bug (structural-gated matching).
[P1] Matching is structurally gated (not fuzzy spray): a PE only shows
  opportunities that pass the structural gate. Spot-check that listed
  opportunities are plausibly that PE's (no obvious false positives).
[P2] Opportunity fields render (title, agency, dates, link); a stale/closed
  opportunity is handled (shown as closed or filtered, per design).
[P2] Action-card "Generate artifact" menu appears on action recommendations;
  selecting a type generates a source-backed artifact and opens the viewer.
   Verify the artifact cites its sources (source-backed, not hallucinated).

================================================================================
C. ENGAGEMENT — OUTREACH DRAFT SAVE & RESUME (the fixes)
================================================================================
Live surface: Engagement → Outreach → v2 wizard (NewOutreachWizard). 7 steps:
Direction, Campaign Setup, Recipients, Template, Build Context, Generate &
Review, Send.

--- C.1 Save draft on any step (R, P0) — the last_step 1..7 fix ---
[P0](R) Advance to STEP 6 (Generate & Review) → "Save as draft" → SUCCESS
  ("Draft saved"), no error toast. (Regression: previously 500'd with Postgres
  23514 outreach_records_last_step_check because the DB CHECK was capped at 5.)
[P0](R) Advance to STEP 7 (Send) → "Save as draft" → SUCCESS. (Same fix.)
[P1] Save on steps 1–5 still succeeds (was always fine; confirm no regression).
[P1] Verify server-side: no `outreach_records_last_step_check` / 23514 in
  CloudWatch /capiro/dev/api during these saves. The DB constraint is now
  CHECK (last_step >= 1 AND last_step <= 7).
[P2] DB column last_step stores the actual step reached (6 or 7), not clamped to
  1 or 5.

--- C.2 Resume a saved draft (R, P0) — the v2 hydration fix ---
[P0](R) Save a draft at step 5 with: client selected, direction chosen, campaign
  name, recipients added, a template picked, context items selected, tone set,
  and (if reached) edited subject/body. Close the wizard. Reopen the draft.
  EXPECT: wizard resumes on the SAVED step (not step 1) with ALL of those fields
  repopulated. (Regression: the v2 wizard used to always restart at step 1 with
  empty state — the loaded record was never passed in.)
[P1] Reopen passes `initialRecord` + `initialDraftId` into the wizard: confirm a
  subsequent "Save as draft" PATCHes the SAME record (no duplicate outreach
  record created). Check the outreach list count doesn't grow on re-save.
[P1] Hydration runs ONCE (guarded by a ref): editing fields after reopen is not
  clobbered by a re-hydrate on re-render.
[P1] Back-compat for OLD drafts: a draft saved by the pre-fix build stored its
  real step in metadata.lastStep while the column was 1. Reopening such a draft
  should still resume at the correct step (hydration falls back to
  metadata.lastStep when the column reads 1). Test with a pre-existing draft if
  one exists; otherwise note as a code-review check.
[P2] Resuming a draft whose client/recipients reference now-deleted entities
  degrades gracefully (no crash; missing items dropped or flagged).

--- C.3 Outreach generate / send (regression around the wizard) ---
[P1] Landing on Generate step auto-generates drafts once (not repeatedly).
[P1] Per-recipient edit (subject/body) persists into the draft and into a
  subsequent save.
[P1] Send: emails go out via the connected mailbox; record status → sent; a
  sent record CANNOT be moved back to draft (BadRequest).
[P1] "Add to brief" from intel/context still works and surfaces in the context
  step.

================================================================================
D. ENGAGEMENT — OUTLOOK / SYNC REGRESSIONS (still must hold)
================================================================================
[P1](R) Microsoft sync does not time out at the client for a slow/large initial
  sync (client timeout 170s, under the 180s ALB idle). (77ece1e)
[P1](R) A deleted-then-recreated user can reconnect Outlook without a unique-
  constraint 500 (orphaned-connection class). Spot-check Lia's account
  (lia@capiro.ai) can connect cleanly now.
[P2](R) A meeting whose connection was removed still exists with connection_id
  null (set-null, not deleted).

================================================================================
E. CROSS-CUTTING
================================================================================
[P0] Clio chat/memory works — no "type public.ClioMemoryScope does not exist"
  500 (f82c05d). Exercise a Clio action that reads/writes memory.
[P0] Auth + tenant resolution intact across portfolio + engagement; no "Could
  not load your profile" 403/500 on normal load.
[P1] Program Elements nav renders as the expandable dropdown (f0cc73d).
[P1] No new console errors / 4xx-5xx navigating portfolio + engagement.

================================================================================
F. AUTOMATED TEST TOUCHPOINTS
================================================================================
API (jest): cd apps/api && timeout 150 npx jest --runInBand --forceExit <pattern>
  - intelligence.manual-mapping.spec.ts, intelligence.profile-v1.spec.ts,
    intelligence.fec-money-flow.spec.ts, intelligence.client-issue-codes.spec.ts
    (these were touched by the security/refactor commits — must stay green).
  - Suggested NEW: a controller spec asserting GET /mappings/:clientId and PATCH
    /mappings/:mappingId return 404 for a foreign-tenant id (locks in the IDOR fix).
  - Suggested NEW: outreach update accepts lastStep 6 and 7 (locks in the CHECK
    widen); the DB enforces it, so an integration-style test is most meaningful.
Web (vitest): cd apps/web && npx vitest run <path>
  - TopAlertsList.test.tsx and intelligence-v1 page tests stay green.
  - Suggested NEW: NewOutreachWizard hydrates from initialRecord/initialDraftId
    → resumes on saved step with fields populated, and re-save PATCHes (no dup).

================================================================================
G. KNOWN BY-DESIGN (don't file as bugs)
================================================================================
- Foreign-tenant id returns 404 (intentional, no existence leak) — not "broken".
- Empty PE Procurement panel for PEs with no structural SAM match.
- Empty FEC/PAC, comment-deadline alerts, contractor $ for clients without the
  underlying data/confirmed mappings.
- profile-v1 latency ~8–18s.
- Single-confirmed-name contractor/lobby $ undercount persists on main (the
  full multi-id roll-up is the unmerged client-data-association branch).
