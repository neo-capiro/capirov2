# Capiro Test Plan — Portfolio, Dashboard, Engagement

Scope: manual + regression QA for the three core surfaces. Written from the
lobbyist-user POV (does the feature help win fights / never miss a deadline /
catch budget moves), not just "API returns 200."

Environment: capiro-dev (= live prod, app.capiro.ai). Use a tenant with real
synced data (capiro-internal has RTX/Raytheon, c2-strategies has defense clients).
Auth via Clerk. Most read paths are tenant-scoped (RLS) — always verify in the
RIGHT tenant.

Legend: [P0]=blocker, [P1]=major, [P2]=polish. (R)=regression for a shipped fix.

VERIFICATION BAR (applies to every case)
- "Works" = the data actually RENDERS end-to-end, not just that the endpoint
  returns rows. A field added server-side must show in the web type + panel + page
  fallback or it's silently dropped.
- "Empty" is sometimes BY DESIGN (no data in window / no confirmed mapping). Each
  case below states whether empty is a bug or expected.
- Watch the browser DevTools Console + Network tab. A red 500/400/403 is a fail
  even if the page partly renders.

================================================================================
1. PORTFOLIO  (client list + client profile / Intelligence tab)
================================================================================
Live surfaces:
- Client list: /clients
- Client profile (LIVE): /clients → intelligence-v1 page (SnapshotSection,
  TopAlertsList, Legislative & Regulatory, Financial Footprint, District Nexus,
  FEC, Lobbying ROI, Relationships).
- Legacy /intelligence/client/:id is REDIRECTED to /clients — do NOT test it as
  the live profile.
- Manage Sources: /settings/intelligence-mappings

--- 1.1 Client CRUD ---
[P0](R) Create client with ONLY a legal name → succeeds; appears in list.
   (Regression: "property uei should not exist" 400 — fixed. name is the only
   required field.)
[P0](R) Create client and fill the government identifiers (UEI, CAGE code, NAICS
   codes, PSC codes) → succeeds; values persist and show on the profile after
   reload. (These fields used to 400 the whole create.)
[P1] Create client with website/description/sectorTag/issueCodes → all persist.
[P1] Edit client (PUT) updates name, sectorTag, issueCodes, gov identifiers.
   Edit requires user_admin role; standard_user is blocked (403).
[P1] Bulk CSV import: dup name within payload and vs existing tenant clients are
   rejected per-row with a clear message; good rows still import.
[P2] Archive client → disappears from list/pickers/dashboard by default;
   re-appears only with includeArchived.
[P1] Tenant isolation: a client created in tenant A is NOT visible in tenant B.

--- 1.2 Tags / Issues / Capabilities config ---
[P1] Add a capability (name, sector, tags, issue codes, PE number). Saves and
   renders on profile.
[P1] sectorTag + capability tags + issueCodes drive bill/regulation matching
   (see 1.5). Setting client-level issueCodes unions with confirmed-LDA codes.
[P2] A client with NO capabilities/tags surfaces no comment-deadline alerts — this
   is EXPECTED (matcher has nothing to match on), not a bug.

--- 1.3 Manage Sources / entity-resolution mappings ---
[P0] Open Manage Sources for a client → lists candidate mappings per source
   (lda / contracting / fec_employer / fec_committee / sec / lobby_intel) with
   confirmed/unconfirmed state.
[P1] Confirm an LDA mapping → lobbying spend on the profile reflects it.
[P1](R) Lobbying spend uses ALL confirmed LDA mappings, not just one. Test a
   client with multiple confirmed LDA registrations (e.g. RTX has 9) → the ROI
   "lobby spend" sums across all of them, not a single ~$30k registration.
   KNOWN GAP to validate: if only one is summed, that's the bug we flagged.
[P1] Contracting mapping name-match: confirming "RTX CORPORATION" only matches
   awards literally named that. Verify Financial Footprint / District Nexus
   UNDER-COUNT when sibling names (e.g. "RAYTHEON COMPANY") aren't also confirmed.
   This is the known coverage gap — document actual vs expected $.
[P2] FEC committee mappings are NEVER auto-confirmed (compliance) — they require a
   human confirm. Verify they appear as unconfirmed candidates.
[P2] Junk fuzzy candidates (e.g. matching on the word "CORPORATION") appear as
   UNCONFIRMED only and do not affect any panel until confirmed.

--- 1.4 Top Alerts worklist (Snapshot section) ---
[P0] Worklist merges up to 7 sources: comment_deadline, change, hearing,
   bill_movement, comment_overdue, competitor_filing, contract_award. Shows top 5
   + "N more" footer (alertsHiddenCount).
[P1] Priority vs Deadline toggle re-sorts (Deadline = soonest countdown first).
[P1] Per-row actions fire + persist per-user state: Dismiss (hidden), Snooze
   (hidden until snoozedUntil; open-ended stays hidden), Acknowledge (kept,
   de-emphasized). State is per-user — a second user sees their own state.
[P1] "Add to brief" on a row → shows in the Outreach wizard context step.
[P1] comment_deadline / hearing / comment_overdue rows show "Add to calendar" +
   "Start outreach"; others show "Add to brief".
[P2] Empty worklist is by-design when the client has no underlying data
   (no tracked bills, no confirmed contracting mapping, no LDA issue codes).
[P1] contract_award alerts: a client with a confirmed contracting mapping AND a
   recent (≤30d) award shows the alert. (Regression watch: if the only confirmed
   name misses the awards, alerts are wrongly empty — tie to 1.3.)

--- 1.5 Tracked bills / Legislative & Regulatory ---
[P1] Tracked bills derive from LDA issue-code names ∪ capability signals, matched
   to bills with cosine ≥ 0.65. "Only a few high-confidence" is the floor working,
   not a bug; tightening capability tags raises matches.
[P2] Hearings no longer render as their own panel here — that signal moved into
   Top Alerts. Confirm the Legislative & Regulatory section reflects that.

--- 1.6 Financial / District Nexus / FEC panels ---
[P1] Financial Footprint and District Nexus read confirmed contracting mappings
   (EXACT name match). Verify total $ and award count match the confirmed name(s)
   only. Document under-count if sibling contractor names aren't confirmed.
[P1] District Nexus $ = SUM of award amounts for matched awards (each award's
   current total value). A large total over few awards can be CORRECT (big DoD
   vehicles) — verify against the per-award drill, not gut feel. Note it can read
   differently from Lobbying-ROI "contractWins" (a separate pre-aggregated table)
   — flag if both numbers are shown without labels distinguishing them.
[P2] FEC money-flow / PAC giving is empty when no confirmed fec_employer /
   fec_committee mapping OR no synced committee — EXPECTED for small clients.

--- 1.7 Profile load / render robustness ---
[P0] Profile page loads fully (no blank screen). A truly-blank authed page = a JS
   render crash (e.g. spreading a null array) — capture Console red line.
[P1] profile-v1 aggregate is slow (~8–18s) but must not fail sources. Check
   CloudWatch for "profile-v1 source ... failed ... Unable to start a transaction"
   warnings (kg_walk pool starvation) — a degraded source = silent data loss.

================================================================================
2. DASHBOARD  (HomePage.tsx — the intel inbox / triage home)
================================================================================
Widgets and their sources:
- Greeting "N signals overnight / M critical" → /api/intelligence/changes (7d).
- Needs Attention banner (max 10, severity-ranked) → MERGE of /comment-alerts
  (FedReg ≤14d), /coming-up (hearings+markups next 7d), /changes (PE budget moves,
  bill stage changes, notable/critical FedReg|FEC).
- Clio Brief gradient card → /api/intelligence/daily-brief (LIVE LLM call).
- Upcoming Deadlines → WorkflowInstance.submissionDeadline (submissions only).
- Changes Inbox page (/intelligence/changes) = the searchable "Inbox".

[P0] Dashboard loads for a tenant with data; greeting count matches changes in 7d.
[P1] Needs Attention shows cross-client items, severity-ranked, capped at 10,
   each row deep-links correctly (e.g. /intelligence/changes?clientId=...).
[P1] DEDUP PRINCIPLE (recurring ask): comment-period alerts appear in ONE place
   (Needs Attention), NOT also in Upcoming Deadlines and the Inbox card. Upcoming
   Deadlines = workflow submissions ONLY. Verify no item shows in 3 places.
[P1] Clio Brief renders a fresh narrative on load ("Today's leverage is…"), has a
   canned "quiet day" branch when all blocks empty, and a numeric fallback on LLM
   failure. 10-min staleTime (not frozen/persisted).
[P1] Clio Brief "today's meetings" block uses true ET-instant bounds — a 9pm-ET
   meeting still appears (regression for the dayBoundsInZone vs dateBoundsInZone
   timezone bug; rows after ~7pm ET must NOT be dropped).
[P1] Changes Inbox: mark-as-read persists across reload (consumed=true). On a
   failed PATCH the item REOPENS and shows an error toast (never silently "read").
   Cleared rows stay gone (consumed:false filter); dashboard counts still see all.
[P2] Taxonomy gap to validate: Needs Attention is missing comment_overdue /
   competitor_filing / contract_award (those are per-client only). Confirm current
   behavior and flag if portfolio-wide parity is expected.

================================================================================
3. ENGAGEMENT  (meetings, mail, contacts, Microsoft 365 / Outlook)
================================================================================
Live surfaces:
- Settings → Integrations (connect/sync Microsoft 365, Google).
- Client profile engagement (meetings, mail threads, contacts).
- Meeting prep / debrief, workflows.

--- 3.1 Microsoft 365 / Outlook OAuth connect ---
[P0] Connect Microsoft 365 from Settings → Integrations → Microsoft account
   picker (prompt=select_account) → callback succeeds → connection shows
   "connected", scopes present (Mail.Read/ReadWrite/Send, Calendars.Read,
   offline_access), token stored.
[P0](R) Reconnect for a user whose account was deleted+recreated: connect must
   succeed and NOT 500 on a unique-constraint collision. (Regression: an orphaned
   connection owned by a deleted user blocked reconnect — persistToken hit
   `Unique constraint failed (tenant_id, provider, account_email)`. Verify a
   deleted-then-recreated user can connect the same mailbox.)
[P1] redirectUrl points at /sign-up area / a single valid WEB_ORIGIN (not the
   whole comma-separated list) — the email/callback link must not be malformed.
[P1] Connecting the WRONG mailbox is preventable: the account picker is forced, so
   a browser signed into another MS account doesn't silently bind it.
[P2] Reduced-consent / missing-scope path → connection flagged needs_configuration
   with a clear "reconnect to grant permissions" message, not a hard crash.

--- 3.2 Sync (mailbox + calendar) ---
[P0] Manual "Sync now" pulls meetings + mail threads; status → connected,
   last_sync_at updates, no lastError.
[P1](R) Slow-connection / large initial sync does NOT abort at the client. Client
   timeout is 170s (raised from 120s), under the 180s ALB idle timeout. Simulate a
   throttled connection → sync completes or returns hasMore without a UI timeout.
   (Regression: 120s abort surfaced as "sync failed / 503".)
[P1] Token auto-refresh: an expired access token with a valid refresh token
   refreshes transparently on sync (no user action). A missing/again-invalid
   refresh token → clear "reconnect Microsoft 365" message, not a silent fail.
[P1] Ownership guard: a user can only sync/reconnect THEIR OWN connection
   (createdByUserId === caller) → else 403 "You can only sync your own Microsoft
   account". Verify with two users.
[P1] Graph transient 5xx/429 with retry-after ≤10s retries once; otherwise returns
   a ServiceUnavailable that the UI shows as a friendly retry message (P2 polish
   if still raw "request failed with status code 5xx").
[P2] markSyncError path: a real Graph failure sets status=error + lastError +
   nextSyncAt +15m; the row reflects it in the UI.

--- 3.3 Real-time (Graph subscriptions / webhooks) ---
[P1] Enable real-time → Graph subscription created; a new email/meeting in the
   mailbox triggers a notification → incremental sync. "missed" lifecycle event
   triggers a catch-up sync.
[P2] Subscription lifecycle (renew/remove) updates syncState.webhooks.

--- 3.4 Meetings / mail / contacts rendering ---
[P0] Synced meetings appear on the client profile and engagement views with
   subject, time (correct ET), organizer, status.
[P1] Meeting↔client association is client-scoped: a meeting links to the right
   client; coworker/other-attendee domains in TO/CC do NOT leak unrelated context
   into prep/debrief. (Strict client-scoped context is a stated requirement.)
[P1] Meeting prep / debrief pulls only client-linked meetings + client-associated
   email threads — no cross-client bleed.
[P2] A meeting whose connection was removed shows connection_id=null but the
   meeting itself is preserved (not deleted). (Regression: orphaned-connection
   cleanup set-nulls meetings, never deletes them.)

--- 3.5 Workflows / deadlines ---
[P1] A WorkflowInstance with submissionDeadline shows in dashboard Upcoming
   Deadlines (submissions only) and is NOT duplicated as a comment alert.
[P1] Workflow create/advance/complete persists; completedAt set on completion.

================================================================================
4. CROSS-CUTTING / NON-FUNCTIONAL
================================================================================
[P0] Auth: every surface requires a valid Clerk session; tenant resolves from the
   session token (v2 token nests org under o.{id,slg,rol} — must still resolve).
   No "Could not load your profile" 403/500 on normal load.
[P0] Tenant isolation across ALL three areas: no data from tenant A visible in B.
[P1] Team seat limit: inviting beyond the Clerk org seat cap shows a CLEAR
   "member limit reached" message (P2 if still generic "Bad Request").
[P1] No console errors / unhandled 4xx-5xx on normal navigation through all three
   areas.
[P2] Performance: profile-v1 ~10s typical; dashboard heavy widgets acceptable;
   no source silently dropped under load.

================================================================================
5. REGRESSION SUITE (this release's fixes — must all pass)
================================================================================
R1  Client create accepts optional uei/cageCode/naicsCodes/pscCodes; name-only
    create still works. (1.1)
R2  Microsoft sync no longer times out at 120s for slow connections (170s). (3.2)
R3  Deleted-then-recreated user can reconnect Outlook (no unique-constraint 500). (3.1)
R4  Clio chat/memory works — no "type public.ClioMemoryScope does not exist" 500. 
    Exercise a Clio action that reads/writes memory.
R5  Program Elements nav renders as the expandable dropdown.
R6  Removed orphaned connection's meetings still exist (connection_id null). (3.4)

================================================================================
6. AUTOMATED TEST TOUCHPOINTS (where to add/extend)
================================================================================
- API (jest): apps/api — intelligence.alerts-worklist.spec.ts,
  intelligence.profile-v1.spec.ts, clients.service.spec.ts,
  insight-generator.service.spec.ts (daily-brief tz bounds).
  Run: cd apps/api && npx jest --runInBand --forceExit <pattern>
- Web (vitest): apps/web — TopAlertsList.test.tsx, intelligence-v1 page tests.
  Run: cd apps/web && npx vitest run <path>
- Suggested NEW coverage:
  * clients.service create persists gov identifiers (R1).
  * microsoft-oauth persistToken adopts/handles a pre-existing (tenant,provider,
    email) connection instead of 500 (R3 — currently unfixed code-side).
  * getLobbyingRoi sums ALL confirmed LDA mappings (1.3 multi-mapping).

================================================================================
7. KNOWN DATA-DEPENDENT EXPECTATIONS (don't file these as bugs)
================================================================================
- Empty FEC/PAC for small clients with no registered PAC.
- Empty comment-deadline alerts for clients with no capabilities/sector match.
- Contractor/lobby $ under-counts when only one name variant is confirmed
  (config gap, documented — confirm sibling names to fix).
- profile-v1 latency 8–18s.
- Committee mark columns (HASC/SASC/HAC-D/SAC-D) blank on PEs = seasonal data not
  loaded, not a render bug (out of scope here, noted for cross-ref).
