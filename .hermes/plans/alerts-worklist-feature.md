# Alerts → Worklist feature (client-profile Top alerts)

Branch: main (synced w/ origin). Approach: **Option A** (compute-on-read for new alert
types; persisted tables ONLY for alert-state + client-briefs). NO deploy. NO sync changes.

## Goals (from Neo)
1. Alert state: acknowledge / dismiss / snooze, persisted **per-user**. Turns glance → worklist.
2. One-click row actions: comment_deadline → "Add to calendar" + "Start outreach";
   changes/others → "Add to client brief". Client briefs surface in the Outreach wizard
   **context** section (new Client Brief subsection; all briefs land there).
3. Deadline-first view/toggle: sort comment deadlines by days-left ASC (soonest #1), and
   show count of items hidden beyond top 5.
4. New alert types merged into topAlerts:
   - Committee hearings & markups (client-scoped via existing hearingsList match). Then
     REMOVE the Hearings & markups UI panel from the intel tab (data keeps flowing to alerts).
   - Tracked-bill movement (CongressBill.latestActionDate recent for pinned TrackedBill).
   - Overdue comment deadline (FedReg commentEndDate just passed, not acted on).
   - New competitor LDA activity on client issue codes (LdaFiling recent, other registrant).
   - New federal contract/award relevant to client (FederalAward.awardedAt recent).

## Data facts (verified)
- CongressBill: latestActionText, latestActionDate(@db.Date), updateDate. TrackedBill: clientId+billId, RLS tenant.
- FederalAward: contractorName, peCode, awardedAt(timestamptz), actionDate(@db.Date), amount.
- LdaFiling exists (competitor filings).
- CommitteeHearing fetched in profile-v1 settled[11]; hearingsList built ~L808 (isTracked filter).
- topAlerts built L468–512 in intelligence.service.ts; placed at sections.snapshot.topAlerts L1049;
  normalized L70-76 (when→iso, countdownDays→finite). Keep _urgencyScore/_typeRank internal (stripped).
- Controller: @Patch('changes/:id') pattern for state; ValidationPipe transform:true, implicit:false.
- Web: SnapshotSection builds clientAlerts/fallback → TopAlertsList. mappers.ts ClientProfileV1 type
  has topAlerts[] + hearingsAndMarkups[] + links{}. LegislativeRegulatorySection renders Hearings panel L440-456.
- Outreach wizard context: pages/engagement/outreach/steps/IntelligenceInsights.tsx (GET outreach-context).
- Runners: web=vitest, api=jest (slow ~30s; use `timeout 150 npx jest --runInBand --forceExit`).
- Ground truth = `pnpm --filter @capiro/{api,web} exec tsc --noEmit`. Linter noise: decorators/iteration/BigInt.

## Schema (new) + migration (RLS, timestamp after latest dir)
### model AlertState  (per-user dismissal/snooze/ack state)  — tenant-scoped, RLS
- id uuid pk; tenantId; userId (clerk id); clientId; alertId (string, stable: e.g. "comment:<docId>",
  "hearing:<id>", "bill:<billId>", "change:<id>", "award:<id>", "competitor:<filingId>");
  state enum-ish string ('acknowledged'|'dismissed'|'snoozed'); snoozedUntil DateTime?; createdAt; updatedAt.
- @@unique([userId, clientId, alertId]); @@index([tenantId]); @@index([clientId]); @@index([userId]).
- RLS: ENABLE/FORCE; policy USING (rls_bypass() OR tenant_id=current_tenant_id()) WITH CHECK same.

### model ClientBrief (saved brief items)  — tenant-scoped, RLS
- id uuid pk; tenantId; clientId; createdBy(userId); sourceAlertId String?; sourceType String?
  (e.g. 'comment_deadline'|'change'|'manual'); title; body @db.Text; createdAt; updatedAt.
- @@index([tenantId]); @@index([clientId]).
- RLS same pattern.

Migration dir: prisma/migrations/<timestamp_after_latest>_alert_state_client_brief/migration.sql
Then `pnpm --filter @capiro/api exec prisma generate`.

## Backend service (intelligence.service.ts)
### New private helpers (compute-on-read), each tenant-scoped, allSettled-safe:
- getHearingAlerts: reuse hearingsList (already client-scoped) → map to alert rows, type 'hearing',
  countdown to date (days-until), severity by days (<3 crit, <=7 notable else info). _typeRank ~2.
- getTrackedBillMovementAlerts(clientId,tenantId): TrackedBill pins → CongressBill where latestActionDate
  within last 14d → alert type 'bill_movement', subtitle latestActionText, when=latestActionDate,
  severity notable (or critical if action text matches vote/floor/passed/markup keywords). _typeRank 1.
- getOverdueCommentAlerts: FedReg docs matched to client (reuse comment-match) with commentEndDate in
  [now-7d, now) → type 'comment_overdue', severity notable, countdown negative (Overdue Nd). _typeRank 2.
- getCompetitorLdaAlerts: client issue codes → recent LdaFiling (last ~30d) by OTHER registrants on same
  codes → type 'competitor_filing', severity info, when=filing date. Cap small. _typeRank 1. Label cadence honestly.
- getContractAwardAlerts: client confirmed contracting mapping contractorName(s) OR client peCodes →
  FederalAward awardedAt within last 30d → type 'contract_award', severity notable, when=awardedAt. _typeRank 1.
All return [] on any failure; each fed into the topAlerts merge array. Keep existing comment_deadline + changes.

### Alert-state filtering + sort + hiddenCount
- Fetch AlertState rows for (userId, clientId). Need userId in getClientProfileV1 → thread ctx.userId
  from controller (currently only tenantId passed). Add optional userId param (back-compat: default applies
  no state filter — keeps existing specs green).
- Drop alerts that are 'dismissed', or 'snoozed' with snoozedUntil>now. 'acknowledged' kept but flagged
  (ackedAt) so UI can de-emphasize.
- Build FULL merged+sorted list; compute hiddenCount = max(0, visible.length - 5); slice(0,5).
- Add `deadlineFirst` support: expose BOTH default-sorted top5 and a `deadlineSorted` ordering? Simpler:
  return full visible list (already sorted default) + hiddenCount; frontend re-sorts for the toggle since
  it has all needed fields (countdownDays). To keep payload small, return up to ~12 rows (top5 shown +
  buffer for the toggle) — actually return all visible but cap at 20; hiddenCount = total - 5. Frontend
  slices to 5 per active sort.
  DECISION: backend returns visible alerts capped at 20 + `alertsHiddenCount` (total visible - 5, min 0).
  Frontend owns top-5 slice per toggle. Keeps deadline-first purely client-side, no extra endpoint.

### Response additions
- sections.snapshot.topAlerts: now up to 20 (was 5). Each row gains: `state?`('acknowledged'|null),
  `actions?`: string[] hint (['calendar','outreach'] for comment_deadline; ['brief'] otherwise) — optional,
  frontend can derive instead. KEEP backward-compat: existing fields unchanged; specs assert shape not length.
- sections.snapshot.alertsHiddenCount: number.
- links: add `outreachWizard` (engagement outreach base) + `calendarBase` if needed (frontend can build).

### Service methods for state + brief
- setAlertState(tenantId,userId,clientId,alertId,state,snoozedUntil?) → upsert by unique key.
- clearAlertState(... ) → delete (for "undo").
- listClientBriefs(tenantId,clientId) → ordered desc.
- addClientBrief(tenantId,clientId,userId,{title,body,sourceAlertId?,sourceType?}) → create.
- deleteClientBrief(tenantId,clientId,briefId).

## Controller (intelligence.controller.ts)
- Thread ctx.userId into getClientProfileV1 call.
- POST   clients/:clientId/alert-state           body {alertId,state,snoozedUntil?}  (DTO validated)
- DELETE clients/:clientId/alert-state/:alertId   (undo) — alertId may contain ':' → use @Param with
  wildcard-safe handling; alertId carries colons, so accept it via body on DELETE or encodeURIComponent.
  DECISION: DELETE clients/:clientId/alert-state with body {alertId} (Nest allows @Body on DELETE) to avoid
  colon-in-path routing issues.
- GET    clients/:clientId/briefs
- POST   clients/:clientId/briefs                 body {title,body,sourceAlertId?,sourceType?}
- DELETE clients/:clientId/briefs/:briefId
DTOs with class-validator; rely on global ValidationPipe.

## Frontend
### mappers.ts
- Extend topAlerts row type: add `state?: 'acknowledged'|null`, keep others.
- Add `alertsHiddenCount?: number` to snapshot. Add links.outreachWizard?.
### TopAlertsList.tsx
- Row controls (hover/inline): Ack ✓, Snooze (1d/3d/7d menu), Dismiss ✕. Wire mutations to
  POST alert-state; optimistic update + rollback + notification on error (per skill robustness rule).
  Invalidate ['client-intel-v1-aggregate', clientId].
- One-click actions per type: comment_deadline → "Add to calendar" (link to engagement calendar w/ prefilled
  deadline) + "Start outreach" (link to outreach wizard w/ clientId + alert context query). Others → "Add to brief"
  (POST briefs, toast success).
- Deadline-first toggle (segmented: "Priority" | "Deadline"). Default Priority = existing sort.
  Deadline = countdownDays ASC (nulls last). Slice to 5 in BOTH; show "N more" using alertsHiddenCount
  (recompute against active filter length).
- Acked rows rendered de-emphasized (badge "Ack'd").
### SnapshotSection.tsx
- Pass alertsHiddenCount + clientId + links to TopAlertsList; thread aggregate through (already has it).
### Outreach wizard context (IntelligenceInsights.tsx or the context step)
- Add "Client Brief" subsection: GET clients/:id/briefs, render list (title + body + remove). Add inline
  "Add note" too. This is where all saved briefs surface.
### Remove Hearings panel
- LegislativeRegulatorySection.tsx: remove the Hearings & markups surface (L440-456 block), the
  HearingsMarkupList import, dynamicHearings/hearingsData derivation, syncCalendarHref/setAlertsHref props if
  now unused (check usage — keep props if still used elsewhere; else remove + update ClientIntelV1Page caller).
  Update section sub-text to drop "· hearings". Keep mappers hearingsAndMarkups type (backend still returns it;
  alerts consume hearing data server-side, so the field may go unused on web — leave type to avoid churn).

## Tests
### API jest
- intelligence.profile-v1.spec.ts: extend — topAlerts still array; with AlertState dismissed row it's filtered;
  snoozed-future filtered, snoozed-past shown; acknowledged kept+flagged; alertsHiddenCount math; hearing alert
  appears when hearingsList non-empty; bill_movement appears for recent latestActionDate; competitor/award/overdue.
- New alert-state + briefs spec: upsert/list/delete behavior with prisma mock (withTenant tx).
- Reuse capiro pattern: prisma mock whose withTenant tx exposes needed models.
### Web vitest
- TopAlertsList.test.tsx: extend — renders row controls; deadline toggle reorders; hidden count; ack/dismiss
  fire mutation; action buttons present per type.
- Outreach brief subsection test (render list from query; add/remove).
### Gates
- prisma generate; `tsc --noEmit` both apps clean; run affected jest + vitest; `git status --short` scope check
  (only my files; DoW/acquisition-personnel files stay untouched). NO docker/ECR/ecs.

## Deploy-time notes for Neo (state in final summary)
- Migration MUST run before table-backed features work (alert-state/briefs).
- New compute-on-read alerts depend on the relevant sync having populated CongressBill.latestActionDate /
  FederalAward.awardedAt / LdaFiling / CommitteeHearing for the test client; thin dev tables → empty (by design).
- Competitor-LDA cadence is quarterly; labeled accordingly.
