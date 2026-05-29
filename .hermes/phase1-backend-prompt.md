# Phase 1: First Intelligence Features — Backend

## YOUR TASK
Implement 5 intelligence features from the Capiro Master Strategy Report. These are the "be told" features per §10.2 and §5.1 that make lobbyists say "this saves me 2 hours/day." Read existing code FIRST.

---

## CRITICAL CONTEXT — READ THESE FILES FIRST

1. `apps/api/src/intelligence/insight-generator.service.ts` — 449 LOC, ALREADY has `generateClientBriefing(clientId, tenantId)` and `generateMarketInsights()` and `generateFromChanges()`. Has dual-provider AI (OpenAI + Anthropic with fallback). READ THIS ENTIRE FILE before writing anything.
2. `apps/api/src/intelligence/intelligence.service.ts` — has `getClientProfile()`, `getChanges()`, `getLobbyingRoi()`, `getCompetitorBoard()`, `getClientBills()`, `getExStaffers()`, entity resolution methods
3. `apps/api/src/intelligence/entity-resolution.service.ts` — resolves clients to external sources
4. `apps/api/src/intelligence/intelligence.controller.ts` — existing endpoints
5. `apps/api/prisma/schema.prisma` — 80+ models, check exact field names

Key tables from schema.prisma:
- `FederalRegisterDocument`: has `commentEndDate`, `agencyNames[]`, `type` (RULE/PROPOSED_RULE/NOTICE), `topics[]`, `significantRule`
- `ClientCapability`: has `sector`, `tags` (JSON), `name`, `peNumber`, `targetSubcommittee`
- `CongressBillSubject`: has `billId`, `name` — joins to `CongressBill`
- `LdaIssueCode`: has `code`, `name`, `totalFilings5y`, `totalSpending5y`
- `Meeting`, `MailThread`, `EngagementTask`, `MeetingDebrief`: CRM tables, tenant-scoped
- `IntelligenceChange`: has `source`, `changeType`, `severity`, `title`, `description`, `relatedClientIds[]`, `relatedIssues[]`, `consumed`, `detectedAt`
- `ClientIntelMapping`: links CRM clients to external sources with `confirmed` flag

---

## FEATURE 1.1: Daily Client Briefing Generator

Per Strategy §3 JTBD #1: "What's happening to my client this week? → Daily AI briefing per client/program, generated from IntelligenceChange events filtered through the entity mapping. Quantified deltas. Suggested actions."
Per §5.4: "Daily Briefing Generator (449 LOC scaffolded; extend with per-client templating + IntelligenceChange filter)."
Per §4.4: "Briefing engine — daily cron, per active profile, per active user, sourced from IntelligenceChange + model scores + RAG-grounded language."
Per §15.2: "Daily Client Briefing — Email + in-app card. Hero summary + three sections (What's new 24h, What's coming 14d, Suggested actions). Per-line citations."

### What to build:

**A. Enhance `generateClientBriefing` in insight-generator.service.ts:**
The existing method (line 214) already gathers LDA context, contractor context, and open regulations. EXTEND it to:
1. Query `IntelligenceChange` from the last 24h where `relatedClientIds` contains this clientId OR `relatedIssues` overlaps with the client's LDA issue codes
2. Query upcoming `CommitteeHearing` in the next 14 days that touch the client's issue areas
3. Query upcoming `FederalRegisterDocument` comment deadlines in the next 14 days
4. Structure the AI prompt into THREE sections per §15.2:
   - "What's New (24h)" — IntelligenceChange events, quantified
   - "What's Coming (14 days)" — upcoming hearings, comment deadlines, bill actions
   - "Suggested Actions" — AI-generated based on urgency and opportunity
5. Return structured JSON: `{ heroSummary: string, whatsNew: Array<{title, source, detail, citation}>, whatsComing: Array<{title, date, type, action}>, suggestedActions: Array<{action, rationale, urgency}>, generatedAt: string }`

**B. Create briefing cron script: `apps/api/scripts/generate-briefings.ts`**
Standalone script: `npx tsx scripts/generate-briefings.ts`
1. Get all tenants
2. For each tenant, get all clients with status='ACTIVE' and at least one confirmed ClientIntelMapping
3. For each client, call the enhanced `generateClientBriefing`
4. Store result as `IntelligenceInsight` with category='briefing', severity='info'
5. Log timing and counts per tenant
6. Use gpt-4o-mini for cost efficiency ($15/mo at pilot per Strategy §11.3 AI/LLM sheet)

**C. Add briefing endpoint if not already present:**
`GET /intelligence/briefing/:clientId` — should already exist (line 147 in controller). Verify it calls the enhanced method. If not, wire it up.

---

## FEATURE 1.2: Bill Tracker per Client (Auto-Matched)

Per Strategy §3 JTBD #3: "Which bills should I be tracking? → Auto-tracked bills per profile based on capability tags ↔ bill subjects / policy areas. Passage-probability score on each. Action-velocity heatmap."
Per §7: "Issue ↔ Bill ↔ NAICS ↔ CFDA — Taxonomy bridge. Every capability auto-feeds bills + regs + grants."

### What to build:

**D. New method in intelligence.service.ts: `getTrackedBills(clientId: string)`**
1. Get the client's confirmed LDA mappings (source='lda')
2. From those LDA clients, get their issue codes (from `lda_filing.issue_codes` JSON array)
3. Also get the client's `ClientCapability` records — extract `sector`, `tags` JSON, `name`
4. Build a bridge: map LDA issue code names → `CongressBillSubject.name` using text similarity or keyword overlap. Use this SQL pattern:
   ```sql
   SELECT DISTINCT cb.* FROM congress_bill cb
   JOIN congress_bill_subject cbs ON cbs.bill_id = cb.id
   WHERE cbs.name ILIKE ANY(ARRAY[...issue_name_patterns...])
   ORDER BY cb.latest_action_date DESC NULLS LAST
   LIMIT 50
   ```
5. Return bills with: identifier, title, latestActionDate, latestActionText, status, sponsorName, sponsorParty, subjectNames[]
6. Add endpoint: `GET /intelligence/clients/:clientId/tracked-bills`

---

## FEATURE 1.3: Competitor Leaderboard per Issue

Per Strategy §3 JTBD #2: "Who else is lobbying on my issue? → Live competitor leaderboard per issue code, with new-entrant alerts (90-day window) and shared-lobbyist warnings."
Per §5.1: "Competitor Surge Detector — Boolean + magnitude per (client, 90-day window) — LdaFiling × ClientIntelMapping issue overlap"

### What to build:

**E. New method in intelligence.service.ts: `getIssueLeaderboard(issueCode: string)`**
1. Query all LDA filings in the last 2 years that include this issue code
2. GROUP BY registrant name, COUNT filings, SUM income
3. Flag new entrants: registrants whose first filing with this issue code is within the last 90 days
4. Flag shared lobbyists: lobbyists who appear on filings for MULTIPLE registrants on this issue (potential conflicts)
5. Return: `{ issueCode, issueName, totalFilings, registrants: Array<{ name, filingCount, totalIncome, isNewEntrant, firstFilingDate, sharedLobbyists: string[] }> }`
6. Add endpoint: `GET /intelligence/issues/:code/leaderboard`

Also enhance the existing `getCompetitorBoard(clientId)` to include the leaderboard data for each of the client's issue codes.

---

## FEATURE 1.4: Engagement Health Score v0

Per Strategy §5.1: "Engagement Health Score — 0-100 per (client, week) — Meeting, mail, outreach stats, debrief count, task completion — JTBD 6"
Per Strategy §3 JTBD #6: "How do I prove what I did this quarter? → Auto-generated client/program report card: meetings, offices touched, comments filed, bills monitored, outcomes captured."

### What to build:

**F. New method in intelligence.service.ts: `computeEngagementHealth(clientId: string, tenantId: string)`**
1. Query last 7 days of activity for this client (ALL tenant-scoped via prisma.withTenant):
   - Count of `Meeting` records (client meetings in last 7 days)
   - Count of `MailThread` messages (mail activity)
   - Count of `EngagementTask` completed (status='completed' in last 7 days)
   - Count of `MeetingDebrief` records (debriefs filed)
   - Count of `OutreachRecord` sent
2. Compute score: `score = Math.min(100, Math.round((meetings * 15 + emails * 2 + tasks_completed * 10 + debriefs * 20 + outreach * 5) / expectedWeeklyPace * 100))`
   where `expectedWeeklyPace = 100` (baseline — a "healthy" client week = ~3 meetings, 10 emails, 2 tasks, 1 debrief, 2 outreach sends)
3. Return: `{ score, breakdown: { meetings, emails, tasksCompleted, debriefs, outreachSent }, trend: 'improving'|'stable'|'declining' (compare vs prior 7 days), period: '7d' }`
4. Add endpoint: `GET /intelligence/clients/:clientId/health-score`

**G. Create nightly health score compute script: `apps/api/scripts/compute-health-scores.ts`**
1. For each tenant, for each active client, compute and store the health score
2. Store as `IntelligenceInsight` with category='health_score' and data containing the breakdown
3. Emit `IntelligenceChange` when score drops below 30 (severity='notable', changeType='low_engagement')

---

## FEATURE 1.5: Comment-Period Urgency Alerts

Per Strategy §5.1: "Comment-Period Urgency — Days-to-deadline × client relevance — regulatory_docket, fed_register, ClientCapability sector — JTBD 4"
Per Strategy §3 JTBD #4: "Should I file a comment on this rule? → Regulatory docket countdown with relevance score against client_capabilities."

### What to build:

**H. New method in intelligence.service.ts: `getCommentPeriodAlerts(tenantId: string)`**
1. Query `FederalRegisterDocument` where:
   - `type` IN ('PROPOSED_RULE', 'RULE') 
   - `commentEndDate` IS NOT NULL and > NOW() and < NOW() + 14 days
2. For each document, compute relevance to each tenant client:
   - Match `agencyNames` against client `sectorTag` using a mapping (e.g., EPA → ENVIRONMENT_WATER, DOD → DEFENSE, HHS → HEALTH, etc.)
   - Match document `topics` against client `ClientCapability.tags` and `ClientCapability.sector`
   - Score: base relevance (0-1) × urgency multiplier (1.0 for >7d, 1.5 for 3-7d, 2.0 for <3d)
3. For each relevant (score > 0.3) document-client pair, emit `IntelligenceChange`:
   - source='federal_register', changeType='comment_deadline_approaching'
   - severity: 'info' if >7 days, 'notable' if 3-7 days, 'critical' if <3 days
   - relatedClientIds: [clientId]
   - title: "Comment period closing in N days: [document title truncated to 80 chars]"
4. Return alerts sorted by urgency
5. Add endpoint: `GET /intelligence/comment-alerts`

**I. Create comment-period check script: `apps/api/scripts/check-comment-periods.ts`**
Standalone cron-able script that runs the alert check for all tenants.

---

## AGENCY-TO-SECTOR MAPPING (needed by 1.5)

Create a static mapping used by the comment-period alerts. Put in a shared constants file or at the top of the service:

```typescript
const AGENCY_SECTOR_MAP: Record<string, string[]> = {
  'Department of Defense': ['DEFENSE'],
  'DOD': ['DEFENSE'],
  'Environmental Protection Agency': ['ENVIRONMENT_WATER'],
  'EPA': ['ENVIRONMENT_WATER'],
  'Department of Health and Human Services': ['HEALTH'],
  'HHS': ['HEALTH'],
  'Food and Drug Administration': ['HEALTH'],
  'FDA': ['HEALTH'],
  'Department of Energy': ['ENERGY'],
  'DOE': ['ENERGY'],
  'Department of Transportation': ['TRANSPORTATION'],
  'DOT': ['TRANSPORTATION'],
  'Department of Agriculture': ['AGRICULTURE'],
  'USDA': ['AGRICULTURE'],
  'Department of Homeland Security': ['HOMELAND_SECURITY'],
  'DHS': ['HOMELAND_SECURITY'],
  'Department of Commerce': ['COMMERCE_TECH'],
  'Federal Communications Commission': ['COMMERCE_TECH'],
  'FCC': ['COMMERCE_TECH'],
  'Department of Education': ['EDUCATION'],
  'Securities and Exchange Commission': ['FINANCIAL_SERVICES'],
  'SEC': ['FINANCIAL_SERVICES'],
  'Department of the Treasury': ['FINANCIAL_SERVICES'],
  'Consumer Financial Protection Bureau': ['FINANCIAL_SERVICES'],
  'Department of the Interior': ['ENVIRONMENT_WATER'],
  'Army Corps of Engineers': ['ENVIRONMENT_WATER', 'DEFENSE'],
};
```

---

## IMPLEMENTATION RULES

1. **READ existing files FIRST** — especially insight-generator.service.ts (the AI provider pattern, prompt style, error handling)
2. **RLS**: `prisma.withTenant(tenantId, tx => ...)` for ALL CRM tables (Client, Meeting, MailThread, EngagementTask, MeetingDebrief, OutreachRecord, ClientCapability). Direct prisma for global tables.
3. **DO NOT** use `Parameters<typeof this.prisma.X.findMany>[0]['where']` — use `Record<string, unknown>`
4. **DO NOT** use conditional spreads `...(cond ? {x} : {})` in Prisma calls
5. **Register new services** in intelligence.module.ts
6. **Match AI model usage**: Use the existing `callAi()` method in insight-generator.service.ts for any AI generation. It already handles OpenAI/Anthropic fallback.
7. **Scripts should be standalone** — connectable via `npx tsx scripts/name.ts`, following the pattern of existing scripts like emit-changes.ts
