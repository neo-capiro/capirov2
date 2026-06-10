# QA Results — Client Profiles

**Environment:** Production `https://app.capiro.ai` (web) + `https://app-dev.capiro.ai/api` (API), AWS account starting `9`.
**Tenant/User:** Capiro org (`org_3DB7…`) / neo@capiro.ai (`standard`+, CTO). 7 active clients.
**Date:** 2026-06-09 · **Scope:** Read-only on real clients + safe writes (one `ZZ-QA-TEST-*` client, cleaned up).
**Method:** Chrome MCP. Screenshots unavailable (MCP tab backgrounded → `visibilityState=hidden` throttles capture); verified via DOM text, accessibility tree, network capture, console, and authenticated API probes from page context.

## Coverage
List/Portfolio, Overview, Capabilities, People, Facilities, Workflows, Documents, Intelligence (all 4 sections), DoW Directory. Backend: all client-profile + intelligence + engagement endpoints. Create/child-entity validation. Auth/negative/error handling. Performance. Accessibility basics. Data integrity round-trip + soft-delete.

## Status: PASS WITH FINDINGS
Core flows function; data renders correctly on warm loads; auth + create validation are solid. Findings below: 1 medium reliability, 1 medium perf, 1 medium error-handling, several low data-integrity/UX/a11y.

---

## Findings

### Bug 1 — Intelligence cold-load returns contradictory/partial data
**Severity:** Medium-High · **Priority:** High · **Reproducibility:** Once (first/cold load of a client's Intelligence; not on reload)
**Preconditions:** Open a data-rich client's Intelligence tab for the first time in a session (tested RTX, 10 LDA ids).
**Actual Result:** Snapshot showed "858 relevant bills" / "Bills tracked: 858"; Legislative section showed "No relevant bills yet — Issue-Bill Linker couldn't find legislation"; Regulatory showed "0 rules tracked · No regulations tracked". On reload the same client correctly showed **50 bills tracked**, a populated kanban (Introduced/In committee/Passed/Enacted), and **29 rules · 50 linked bills**.
**Evidence:** Intercepted the actual XHR on warm reload: `kanbanTotal=50, colCounts=[13,35,1,1] (=50), regTotal=29, regLinked=50, rails=8, highlight "Bills tracked"=50` → UI rendered correctly. The first direct fetch returned `colCounts=[12,12,1,1]` summing to **26** while `kanbanTotal` said 50 → partial aggregation. `858` = the broad issue-code universe (`/bills` total); `50` = `/tracked-bills` total. The frontend empty state at `LegislativeRegulatorySection.tsx:345` fires only when all kanban `count`=0, so the cold response must have carried empty legislative/regulatory data.
**Notes:** `profile-v1` is a heavy server-side aggregate; on a cold cache it appears to return partial/empty sections and an inflated bill count, producing self-contradictory UI. Matches the known "swallowed errors blank sections silently" risk.
**Recommended Additional Tests:** Hit `profile-v1` repeatedly cold (clear server cache / new client) and assert section determinism; assert `kanban.total === sum(column counts)`; assert "Bills tracked" stat uses tracked count (50) not broad universe (858); add a per-section loading/error state instead of silent empty.

### Bug 2 — `profile-v1` latency ~13–15 s (user-facing Intelligence tab)
**Severity:** Medium · **Priority:** High · **Reproducibility:** Always (3+ measurements: 13.05s, 14.98s, 13.45s, 12.86s)
**Preconditions:** Open Intelligence tab for any client.
**Actual Result:** The Intelligence tab's single aggregate call `GET /intelligence/clients/:id/profile-v1` consistently takes 13–15 s before content appears. Related sub-endpoints are also slow: `tracked-bills` 8.4s, `bill-research` 8.4s, `report-card` 3.6s, `bills` 2.0s (fast ones: client/capabilities/people/facilities/health/setup all <250ms).
**Notes:** 13–15s for a primary tab is a poor first impression and increases the chance of hitting the cold/partial state in Bug 1.
**Recommended Additional Tests:** Profile `profile-v1` server-side to find the dominant sub-aggregation; consider per-section streaming/lazy-load; cache warmup; p95 SLO.

### Bug 3 — Malformed (non-UUID) client id returns HTTP 500 instead of 400
**Severity:** Medium · **Priority:** Medium · **Reproducibility:** Always
**Preconditions:** Authenticated request with a non-UUID id.
**Actual Result:** `GET /api/clients/not-a-uuid` → **500** `{"message":"Internal server error"}`. Same for `/clients/123` and `/intelligence/clients/not-a-uuid/profile-v1`. A well-formed but non-existent UUID correctly returns 404; missing/invalid token correctly returns 401.
**Notes:** Likely an uncaught Prisma "invalid UUID" (P2023) not mapped to 400. Message is generic (no internal leak — good), but a malformed path param is client error (400), not server error (500). 500s also pollute error monitoring/alarms.
**Recommended Additional Tests:** Add a UUID `ParseUUIDPipe`/validation on `:id` params across clients + intelligence controllers; assert 400 for malformed ids; re-test all `:id` routes.

### Bug 4 — Facility: no state↔congressional-district cross-validation
**Severity:** Medium · **Priority:** Medium · **Reproducibility:** Always
**Preconditions:** Add a facility via API/UI.
**Actual Result:** `POST /clients/:id/facilities {state:'CA', congressionalDistrict:'99'}` → **201 created**. California has 52 districts; 99 is impossible. The regex only enforces 1–2 bare digits (`3A`/`abc` correctly 400), and state is only length-checked (≤2 chars) — `state:'ZZ'` also **201** (no real-state set).
**Notes:** Congressional district powers facility→PE place-of-performance relevance; invalid districts can feed wrong district-nexus matching. Data-integrity gap.
**Recommended Additional Tests:** Validate district against the state's actual district count; validate state against the 50-state + territory set; back-test existing facility rows for out-of-range districts.

### Bug 5 — Capability `fundingAsk` accepts negative values
**Severity:** Low · **Priority:** Low · **Reproducibility:** Always
**Actual Result:** `POST /clients/:id/capabilities {name, fundingAsk:-1000}` → 201. No `min:0`. (TRL 0/10 and MRL 11 correctly 400; TRL 1–9 / MRL 1–10 enforced.)
**Recommended Additional Tests:** Add `@Min(0)` to `fundingAsk`; verify UI funding display with 0/negative.

### Bug 6 — Duplicate person email allowed within one client
**Severity:** Low · **Priority:** Low · **Reproducibility:** Always
**Actual Result:** Two people with identical email on the same client both → 201 (no uniqueness). Invalid email correctly 400; missing name correctly 400.
**Notes:** Confirms flagged risk — can create duplicate/confusing contacts.
**Recommended Additional Tests:** Decide intended behavior; if unique, add constraint + friendly 409.

### Bug 7 — Capability description renders raw LaTeX/markdown literally
**Severity:** Low · **Priority:** Low · **Reproducibility:** Always (RTX → SPY-6 Radar)
**Actual Result:** Description shows literal `\(2^\prime \times 2^\prime \times 2^\prime\)` and run-together headings/bullets ("…TechnologiesUnmatched Sensitivity:") — math/markdown in the (AI-generated) description isn't rendered.
**Recommended Additional Tests:** Decide if descriptions are markdown/LaTeX-capable; render or sanitize accordingly; check other AI-generated descriptions.

### Bug 8 — Client profile not deep-linkable; reload loses selection
**Severity:** Low-Medium · **Priority:** Low · **Reproducibility:** Always
**Actual Result:** Selecting a client keeps the URL at `/clients` (state-based). Reload returns to the list and loses the open profile/tab. Cannot bookmark, share, or restore a specific client profile or Intelligence tab.
**Recommended Additional Tests:** Route per client (`/clients/:id` + `?tab=`); restore tab/scroll on reload.

### Bug 9 — Accessibility: incomplete tab semantics + missing logo alt text
**Severity:** Low-Medium · **Priority:** Low · **Reproducibility:** Always
**Actual Result:** Profile tabs are `<div role="tab">` but with **no parent `role="tablist"`** and **no `aria-selected`** on the active tab → screen readers can't convey the tab group or which tab is active; keyboard arrow-key tab nav unlikely. On the Portfolio list, **7/9 images (client logos) have no `alt`** (WCAG 1.1.1). (Profile-detail logo correctly has `alt`. `lang="en"` set; all buttons have accessible names.)
**Recommended Additional Tests:** Wrap tabs in `role="tablist"`, add `aria-selected`/`tabindex` roving + arrow-key nav; add `alt` to logo `<img>` (client name) with empty-alt for decorative.

### Bug 10 — New Client form: empty-name submit blocks silently (no inline error)
**Severity:** Low · **Priority:** Low · **Reproducibility:** Always
**Actual Result:** Clicking submit with an empty form keeps the dialog open and creates nothing (good), but shows no inline "Legal name is required" message. (Backend correctly enforces name.)
**Recommended Additional Tests:** Surface inline required-field errors and focus the first invalid field.

### Observation — Overview engagement fields inconsistent
**Severity:** Low. "ENGAGEMENT START: -" while "ENGAGEMENT: Active · since Jun 2, 2026" (two fields: manual start vs derived createdAt). Confusing; consider reconciling labels.

---

## What passed / verified good
- **Auth:** no-token and bad-token → 401; well-formed unknown UUID → 404.
- **All 8 tabs render** with correct data and clean, helpful empty states (incl. Defense-budget-exposure guidance, FEC legal disclaimer, Workflows kanban).
- **Create validation:** name 1–200, email format, website URL, UEI ≤12, CAGE ≤5 all return clean 400s; **no invalid records created**.
- **Child validation:** TRL 1–9, MRL 1–10, employeeCount ≥0, district regex enforced.
- **Sector filter** (API): DEFENSE→4, ENERGY→1, correct subsets.
- **Logo fallback** (initials "NN") works when no logo.
- **Data round-trip:** created caps/people/facilities persisted and read back correctly.
- **Soft-delete (archive):** removes client from active list (back to 7); children deletable.
- **No console errors/exceptions** observed during the session.

## Not tested / limitations
- Screenshots (MCP tab backgrounded). Cross-tenant isolation (single tenant/login). Concurrency races (logo upload, resolution). Bulk import row limits (would write many prod rows). File-upload size/type rejection via UI (skipped to avoid prod writes). Thin-signal client (0 LDA ids) Intelligence not opened in UI (RTX cold load already exercised empty states).
- Cleanup note: delete is soft (archive) — an archived `ZZ-QA-TEST-2026-06-090543` row remains in the DB (no hard-delete API). Its child caps/people/facilities were hard-deleted.
