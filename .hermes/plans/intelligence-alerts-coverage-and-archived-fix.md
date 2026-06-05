# Intelligence Alerts — Coverage & Archived-Client Fix Plan

**Status:** Draft / not started
**Author:** (drafted from investigation 2026-06-05)
**Scope:** Client-profile Intelligence tab "Top alerts", dashboard "Needs Attention" banner, and the Changes Inbox — plus making archived ("deleted") clients disappear from every Intelligence surface.

---

## 1. Background — the four reported symptoms

1. **Client profile → Alerts section only shows "filings."** Is the section broken, or is it just no data?
2. **Dashboard "Needs Attention" only shows comment alerts.** It should show the same taxonomy as the client tab, but tenant-wide.
3. **Inbox only shows comments.** Same expectation as the dashboard.
4. **"Needs Attention" and Inbox still show archived/deleted clients.** Deleting a client should remove it everywhere.

## 2. Root-cause summary

There is **no hardcoded single-type filter** on any of the three surfaces. They share one taxonomy of alert categories: `comment_deadline`, `comment_overdue`, `competitor_filing`, `contract_award`, `hearing`, `bill_movement` (+ generic `intelligence_change` rows). What renders is driven by (a) which categories actually have matching data and (b) two real bugs.

| # | Symptom | Cause | Type |
|---|---------|-------|------|
| 1 | Client tab → only filings | Per-client merge (`intelligence.service.ts:601-639`) returns only the sources that matched; for that client only `competitor_filing` fired. Falls back to comment-only `fallbackAlerts` when the merge is empty. | Data / thin-signal |
| 2 | Dashboard → only comments | `NeedsAttention` `useMemo` omits `portfolioAlerts` from its deps (`HomePage.tsx:384`), so it freezes on the comment-only legacy fallback computed before the slow `portfolio-alerts` query resolves. | **Bug (FE)** |
| 3 | Inbox → only comments | No memo bug here (deps are correct). Purely data: portfolio alerts + stored change rows are comment-dominated. | Data / thin-signal |
| 4 | Archived clients persist | "Delete" = soft archive (`status:'archived'`, `clients.service.ts:216`). `comment-alerts` filters the wrong field; `/api/clients` returns archived; per-client alert methods don't guard archived. | **Bug (BE)** |

Key confirmations from the code:
- `archive()` sets `status:'archived'` only — it does **not** change `profileStatus` (`clients.service.ts:216-218`).
- `getCommentPeriodAlerts` filters `profileStatus:'ACTIVE'`, NOT `status` (`intelligence.service.ts:3168`) → archived clients leak.
- `ClientsService.list` has no status filter (`clients.service.ts:53-62`) → archived clients in the name map / pickers.
- `getChanges` (`:1979`) and `computePortfolioAlerts` (`:5164`) **do** filter `status != 'archived'` correctly.

---

## Workstream A — Dashboard "Needs Attention" stale memo (frontend)

**Goal:** Banner shows the full cross-client taxonomy instead of falling back to comment-only.

**File:** `apps/web/src/pages/HomePage.tsx`

- **A1.** Add `portfolioAlerts` to the `useMemo` dependency array at line 384.
  ```diff
  - }, [alerts, comingUp, changes, clientNameById]);
  + }, [alerts, comingUp, changes, clientNameById, portfolioAlerts]);
  ```
  Rationale: `portfolioAlerts` is read inside the memo (lines 290-305) and gates the legacy-feed suppression (`hasPortfolio`). It is the slowest input (serial per-client roll-up, 2-min server TTL), so it almost always arrives after the other deps have settled; without it in the deps the memo never recomputes and the banner stays on the comment-only fallback.

- **A2.** (Optional hardening) The `loading` prop already waits on `portfolioAlerts.isLoading` (line 191) — keep it so the banner doesn't flash the legacy fallback before portfolio data lands.

**Verification:** On a tenant whose portfolio roll-up contains non-comment categories, confirm the banner shows them. Add a unit/RTL test that mounts `NeedsAttention` with `portfolioAlerts=[]` then rerenders with a populated `portfolioAlerts` and asserts the banner updates.

**Risk:** Minimal (one-line dep fix). Watch for an extra recompute on each portfolio refetch — negligible.

---

## Workstream B — Archived-client exclusion (backend + frontend)

**Goal:** A soft-archived client never appears in any Intelligence surface, client picker, or name label.

### B1. Fix the comment-alerts leak (highest priority)
**File:** `apps/api/src/intelligence/intelligence.service.ts:3161-3184` (`getCommentPeriodAlerts`)
- Change the client query to exclude archived. Keep the active-profile intent but key off `status`:
  ```diff
  - where: { profileStatus: 'ACTIVE' },
  + where: { status: { not: 'archived' }, profileStatus: 'ACTIVE' },
  ```
  Note: confirm whether `profileStatus:'ACTIVE'` is still the desired gate at all — if onboarding leaves clients at a non-`ACTIVE` profileStatus, this query may be under-returning live clients too (possible secondary contributor to "thin signal"). Decide: keep both filters, or replace with `status != 'archived'` only. **Flag for product/eng decision.**
- This feeds `/intelligence/comment-alerts` (dashboard fallback feed + client-profile `fallbackAlerts`).

### B2. `/api/clients` should not return archived by default
**Files:** `apps/api/src/clients/clients.service.ts:53-62` (`list`), `apps/api/src/clients/clients.controller.ts:195` (`@Get()`), `ListClientsFilter` (`clients.service.ts:27-30`)
- Default `list()` to exclude `status:'archived'`; add an explicit opt-in so management screens can still see archived:
  ```ts
  async list(ctx, filter: ListClientsFilter = {}) {
    const where: Record<string, unknown> = {};
    if (filter.profileStatus) where.profileStatus = filter.profileStatus;
    if (filter.sectorTag) where.sectorTag = filter.sectorTag;
    if (!filter.includeArchived) where.status = { not: 'archived' }; // NEW default
    if (filter.status) where.status = filter.status;                  // explicit override
    ...
  }
  ```
  Add `includeArchived?: boolean` and `status?: string` to `ListClientsFilter`, and wire a `?includeArchived=` / `?status=archived` query param in the controller.
- **REQUIRED audit before merging:** grep every `/api/clients` caller. Known consumers already filter client-side (`AppShell.tsx`, `EngagementPage.tsx` use `.filter(c => c.status !== 'archived')`) — those become redundant (harmless). **Find any "Archived clients" view/tab that relies on archived being in the payload** and switch it to `includeArchived=true`. Do not flip the default until that audit is done.
- After this lands, the dashboard `clientNameById` (`HomePage.tsx:72-76`) and inbox naturally drop archived names with no FE change.

### B3. Clio proactive alerts (Clio brief / "inbox"-adjacent)
**File:** `apps/api/src/clio/clio.service.ts:1625-1642` (`listAlerts`)
- `listAlerts` returns `clioProactiveAlert` rows by `status:'pending'` with no client join, so alerts whose `sourceId` is an archived client (e.g. `meeting_prep`, `:1769`) can surface. Stale-client generation already filters `status:'active'` (`:1809`), but consumption does not.
- Fix: when an alert references a client (`sourceType` in `meeting_prep`/`stale_client`/...), exclude rows whose client is archived — either join/filter on read, or mark related pending alerts resolved when a client is archived (see B4). Lower priority if the user's "inbox" means only the Changes Inbox; include if it means the Clio brief too. **Confirm which "inbox."**

### B4. (Recommended) Resolve dangling state on archive
**File:** `apps/api/src/clients/clients.service.ts:216` (`archive`)
- When archiving, also resolve/close that client's pending `clioProactiveAlert` rows and (optionally) its `clientIntelMapping` / alert-state rows, so nothing dangles in caches. Keeps B3 robust without per-read joins.

---

## Workstream C — Per-client archived guards (backend, defense-in-depth)

**Goal:** Even a direct request for an archived client's data returns nothing (or 404), so a stale link / direct nav can't resurface alerts.

These per-client methods do `findFirst({ where: { id: clientId } })` with **no** archived guard (verified line numbers):
- `getClientProfileV1` — `:292` (the main one; feeds Top Alerts + portfolio)
- `getClientProfile` (legacy v0) — `:178`
- `getOverdueCommentAlerts` — `:3425`
- `getCompetitorLdaAlerts` — `:3518`
- `getContractAwardAlerts` — `:3633`
- plus per-client lookups at `:2026, :2145, :2296, :2580, :2835, :3681, :3716`
- `getAllMappingsForTenant` — `:4163` (tenant-wide; returns mappings for archived clients too)

**Approach (avoid 12 scattered edits):**
- **C1.** Add a small private helper, e.g. `assertActiveClient(tenantId, clientId)` that loads the client and throws `NotFoundException` (or returns a sentinel) when `status === 'archived'`. Call it at the **entry points**: `getClientProfileV1` (`:289`), `getClientProfile` (`:174`), and the standalone alert methods (`getOverdueCommentAlerts`, `getCompetitorLdaAlerts`, `getContractAwardAlerts`). Because portfolio/changes already pre-filter archived, this is purely to harden the direct-by-id paths.
- **C2.** Decide product behavior for opening an archived client's Intelligence tab: 404 vs. read-only "This client is archived" empty state. Recommend the empty state (less jarring than a hard 404 on an existing-but-archived record).
- **C3.** `getAllMappingsForTenant` (`:4163`): add `status != 'archived'` to its client scope so resolution/admin views don't operate on archived clients.

**Verification:** API test — archive a client, then call `GET /intelligence/clients/:id/profile-v1` and assert empty/404; call `/intelligence/comment-alerts` and `/intelligence/portfolio-alerts` and assert the archived client is absent.

---

## Workstream D — Alert-category coverage / thin-signal (data investigation)

**Goal:** Explain and improve why non-comment categories (`competitor_filing`, `contract_award`, `hearing`, `bill_movement`) rarely fire — the deeper reason #1 and #3 look "comment-only." This is a **separate, larger effort**; this plan only scopes the investigation.

Investigate, per category, why the source returns 0 rows for typical clients:
- **`contract_award`** (`getContractAwardAlerts :3570`): requires a **confirmed** contracting mapping. Audit how many clients have one; surface "no contracting mapping" in the UI so it's clearly "unmapped" not "broken."
- **`competitor_filing`** (`getCompetitorLdaAlerts :3507`): depends on the client's issue codes + a 30-day LDA window. Audit issue-code coverage.
- **`bill_movement`** (`:572-596`): requires a **tracked** bill (auto-matched or pinned) with an action in 14 days. Tie to the known GIGO bill-matching issue — auto-match precision/recall.
- **`hearing`** (`getHearingAlerts :3352`): 21-day lookahead against `committeeHearing`; check ingestion freshness.
- **`comment-alerts` profileStatus gate** (B1): verify it isn't also suppressing live clients.

Deliverable: a per-source coverage report (clients with mapping vs. alerts produced) + a UI affordance distinguishing "no data" from "not mapped yet" (the Top Alerts empty state at `TopAlertsList.tsx:294-299` and the "Add tracked issues via source mappings →" footer already gesture at this).

---

## Cross-cutting — caching & invalidation

Even after the filters are correct, archived clients linger briefly due to caches. Document/decide:
- `portfolio-alerts`: 2-min server TTL + in-flight dedupe (`intelligence.service.ts:5107-5133`).
- FE `staleTime`: `clients` 60s, `comment-alerts` 5m, `coming-up` 5m, `portfolio-alerts` 2m.
- **Recommendation:** on archive (`ClientsService.archive`), bust/skip the portfolio cache for the tenant (or accept ≤2-min lag and document it). On the FE, invalidate `['clients']`, `['portfolio-alerts']`, `['comment-alerts-dashboard']`, `['intel-changes-*']` after a successful archive mutation.

---

## Testing & verification checklist

- [ ] FE: `NeedsAttention` rerenders to include portfolio categories once `portfolioAlerts` resolves (A1 regression test).
- [ ] BE: archived client absent from `/intelligence/comment-alerts` (B1).
- [ ] BE: `/api/clients` excludes archived by default; `?includeArchived=true` returns them (B2).
- [ ] BE: archived client absent from `/intelligence/portfolio-alerts` and `/intelligence/changes` (already filtered — add regression tests so it can't regress).
- [ ] BE: `GET /intelligence/clients/:archivedId/profile-v1` returns empty/404 (C1).
- [ ] FE audit: no "Archived clients" screen broke from B2.
- [ ] E2E: create client → generate alert → archive → confirm it vanishes from client tab, dashboard, and inbox within the documented cache window.
- [ ] Gate: typecheck + prettier + tests (note: repo `pnpm lint` is known-broken — do not gate on it).

## Risks & sequencing

1. **A1** — ship first, standalone, lowest risk; directly fixes the dashboard symptom.
2. **B1** — small, high-value; pairs with A1 to make the dashboard correct.
3. **B2** — do the caller audit before flipping the `/api/clients` default; this is the one cross-app change.
4. **C1–C3** — defense-in-depth; safe once B is in.
5. **B3/B4** — only if "inbox" includes the Clio brief; otherwise backlog.
6. **D** — separate investigation/initiative; not blocking.

**Two-clone caution:** make all edits in the canonical OneDrive `main` clone (this working directory), not the diverged second clone.
