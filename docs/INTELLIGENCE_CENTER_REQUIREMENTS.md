# Intelligence Center, Requirements & Deployment Plan

**Author:** Neo Martinez (CTO) + AI Analysis  
**Date:** May 21, 2026  
**Status:** Pre-deployment, ready for implementation  
**Scope:** Bug fixes, frontend decomposition, synthesis layer, AI insight pipeline

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Phase 1, Bug Fixes (Ship Blockers)](#2-phase-1--bug-fixes-ship-blockers)
3. [Phase 2, Frontend Decomposition](#3-phase-2--frontend-decomposition)
4. [Phase 3, Synthesis Layer (New Feature)](#4-phase-3--synthesis-layer-new-feature)
5. [Phase 4, AI Insight Pipeline (New Feature)](#5-phase-4--ai-insight-pipeline-new-feature)
6. [Database Changes](#6-database-changes)
7. [API Contract](#7-api-contract)
8. [Frontend UX Specifications](#8-frontend-ux-specifications)
9. [Deployment Sequence](#9-deployment-sequence)
10. [Testing Requirements](#10-testing-requirements)

---

## 1. Executive Summary

The Intelligence Center has 10 tabs, 4 backend controllers, ~40 API routes, 535K LDA filings, 192K contributions, 10K Federal Register documents, and 7 sync scripts. **The code is technically sound and well-built.**

**The problem:** It's a government data browser, not an intelligence product. Every tab shows raw data in tables and charts. There's no cross-referencing, no client context, no proactive alerts, and the AI insights pipeline is a stub.

A lobbyist using this today has to:
- Manually search 10 different tabs
- Cross-reference data in their head (which bills affect which clients?)
- Check for changes themselves (what's new this week?)
- Generate their own takeaways (so what?)

**This plan fixes all known bugs, decomposes the frontend monolith, then adds a synthesis layer that connects intelligence data to CRM clients and generates AI-powered insights automatically.**

---

## 2. Phase 1, Bug Fixes (Ship Blockers)

### 2.1 CRITICAL: FEC Sync Creates Duplicates on Re-run

**File:** `apps/api/scripts/sync-fec.ts`  
**Line:** 227  
**Problem:** `prisma.fecContribution.create()` is used instead of `upsert()`. The in-memory dedup Set doesn't persist across runs. Re-syncing doubles contribution data.

**Fix:** Change `create()` to `upsert()` keyed on a composite of `(committeeId, candidateName, employer, amount, cycle)` or add a computed hash field as the unique key.

**Verification:** Run sync twice, assert contribution count doesn't change.

---

### 2.2 CRITICAL: sync:regulations Not Registered in package.json

**File:** `apps/api/package.json`  
**Problem:** `scripts/sync-regulations.ts` exists but has no npm script entry. Cannot be executed via `pnpm`.

**Fix:** Add to package.json scripts:
```json
"sync:regulations": "tsx scripts/sync-regulations.ts"
```

**Verification:** `pnpm --filter @capiro/api sync:regulations` runs successfully.

---

### 2.3 CRITICAL: RegulatoryDocket Table Has No API Endpoints

**File:** New module needed  
**Problem:** `sync-regulations.ts` populates `regulatory_docket` table (10K dockets from regulations.gov), but no NestJS module exposes it. The Regulations tab only uses `/federal-register/*` endpoints. An entire data source is invisible.

**Fix:** Either:
- **(Preferred)** Create `regulatory-docket.controller.ts` + `regulatory-docket.service.ts` with endpoints for paginated listing, search, and upcoming comment deadlines. Then add a "Dockets" section to the Regulations tab.
- **(Alternative)** Merge docket data into the Federal Register module's response, add a `dockets` array alongside `documents` in the Regulations panel.

**Endpoints needed:**
```
GET /api/regulatory-dockets?page&limit&agency&type
GET /api/regulatory-dockets/upcoming-deadlines
GET /api/regulatory-dockets/:documentId
```

---

### 2.4 HIGH: Congress "Active Bills" Filter is Non-functional

**File:** `apps/api/src/lda-intel/lda-intel.controller.ts` (CongressBillsQueryDto, line 103)  
**File:** `apps/api/src/lda-intel/lda-intel.service.ts` (getCongressBills, line 460)  
**Problem:** Frontend sends `activeSince` query param (line 1385 of IntelligenceCenterPage.tsx), but `CongressBillsQueryDto` has no such field. NestJS silently strips it. The toggle button renders but does nothing.

**Fix:**
1. Add `activeSince` field to `CongressBillsQueryDto`:
   ```typescript
   @IsOptional()
   @IsString()
   activeSince?: string;
   ```
2. Pass it through the controller to `getCongressBills()`.
3. In the service, add a where clause filtering on `latestActionDate >= activeSince`.

**Verification:** Toggle "Active Bills", confirm result set changes and shows only bills with recent activity.

---

### 2.5 HIGH: SYNC_YEARS Hardcoded in sync-lda.ts

**File:** `apps/api/scripts/sync-lda.ts` line 23  
**Problem:** `const SYNC_YEARS = [2021, 2022, 2023, 2024, 2025, 2026]`, must be manually updated every year.

**Fix:**
```typescript
const currentYear = new Date().getFullYear();
const SYNC_YEARS = Array.from({ length: 6 }, (_, i) => currentYear - 5 + i);
```

---

### 2.6 MEDIUM: Prisma OR Syntax in getInsights()

**File:** `apps/api/src/lda-intel/lda-intel.service.ts` line ~626  
**Problem:** `where.OR = [...]` is a raw property assignment that may break on Prisma version upgrades.

**Fix:** Use proper Prisma syntax:
```typescript
where = { ...where, OR: [...] };
```

---

### 2.7 MEDIUM: Missing GIN Trigram Indexes

**Problem:** ILIKE queries on `lda_filing.client_name` and `lda_filing.registrant_name` (535K rows) don't use B-tree indexes. Performance degrades at scale.

**Fix:** Add a Prisma migration with raw SQL:
```sql
CREATE INDEX CONCURRENTLY idx_lda_filing_client_name_trgm
  ON lda_filing USING gin (client_name gin_trgm_ops);
CREATE INDEX CONCURRENTLY idx_lda_filing_registrant_name_trgm
  ON lda_filing USING gin (registrant_name gin_trgm_ops);
CREATE INDEX CONCURRENTLY idx_lda_filing_issue_codes_gin
  ON lda_filing USING gin (issue_codes);
```

---

### 2.8 LOW: POST /insights/generate is a Stub

**File:** `apps/api/src/lda-intel/lda-intel.controller.ts` line 312-315  
**Problem:** Returns `{ message: 'Insight generation triggered', status: 'queued' }` but does nothing.

**Fix:** Will be replaced by the AI Insight Pipeline (Phase 4). For now, document as stub or remove the endpoint to avoid confusion.

---

### 2.9 LOW: antd Card bodyStyle Deprecation

**File:** `IntelligenceCenterPage.tsx` lines 404, 1095, 2048  
**Fix:** Replace `bodyStyle={{ padding: '...' }}` with `styles={{ body: { padding: '...' } }}`.

---

### 2.10 LOW: Filings Panel Uses Raw HTML Buttons

**File:** `IntelligenceCenterPage.tsx` lines 1124-1138  
**Fix:** Replace with Ant Design `<Pagination>` component for consistency with all other tabs.

---

## 3. Phase 2, Frontend Decomposition

### 3.1 Current State

`IntelligenceCenterPage.tsx`, 2,220 lines, 12 components in one file.

### 3.2 Target Structure

```
apps/web/src/pages/intelligence/
├── IntelligenceCenterPage.tsx     # ~100 lines, tabs, shared state, client filter
├── types.ts                        # ~130 lines, all TypeScript interfaces
├── utils.ts                        # ~80 lines, formatMoney, formatNum, issueTagColor,
│                                   #             trajectoryTag, surgeBadge, formatPosition,
│                                   #             ISSUE_PALETTE, CATEGORY_COLORS
├── InsightsBanner.tsx              # ~70 lines
├── BillDetailRow.tsx               # ~75 lines
└── panels/
    ├── LdaOverviewPanel.tsx        # ~340 lines
    ├── FilingsPanel.tsx            # ~85 lines
    ├── FirmsPanel.tsx              # ~80 lines
    ├── LobbyistsPanel.tsx          # ~120 lines
    ├── CongressPanel.tsx           # ~140 lines
    ├── PacsPanel.tsx               # ~85 lines
    ├── ContractingPanel.tsx        # ~130 lines
    ├── AgenciesPanel.tsx           # ~85 lines
    ├── LobbyingPanel.tsx           # ~135 lines
    └── RegulationsPanel.tsx        # ~200 lines
```

### 3.3 Shared Dependencies (what gets extracted to where)

| Current Location | Target | Consumers |
|---|---|---|
| Interfaces (lines 52-270) | `types.ts` | All panels |
| formatMoney, formatNum (lines 274-286) | `utils.ts` | All panels |
| issueTagColor, ISSUE_PALETTE (lines 288-297) | `utils.ts` | LdaOverview, Filings, Lobbying |
| trajectoryTag (lines 299-313) | `utils.ts` | Lobbying |
| surgeBadge (lines 315-324) | `utils.ts` | Lobbying |
| CATEGORY_COLORS (lines 326-328) | `utils.ts` | Contracting |
| formatPosition (lines 330-352) | `utils.ts` | Lobbyists |
| InsightsBanner (lines 356-425) | `InsightsBanner.tsx` | IntelligenceCenterPage |
| BillDetailRow (lines 429-501) | `BillDetailRow.tsx` | CongressPanel |

### 3.4 Shared State Across Panels

Only two pieces of state flow between panels:
- `clientFilter: string`, passed as prop to LdaOverview, Filings, Congress
- `navigateTo(tab, client?)`, used by LdaOverview (click client → Filings), Firms (click firm → Filings)

Both pass as props. No context or store needed.

### 3.5 Risk Assessment

**Risk: LOW.** Every panel is already a self-contained function with its own state and API queries. This is a pure extract-and-import refactor, zero logic changes, zero API changes.

---

## 4. Phase 3, Synthesis Layer (New Feature)

This is the core product upgrade. The synthesis layer connects CRM client data to global intelligence data and produces cross-referenced, client-specific views.

### 4.1 Client Intelligence Profile

**What it does:** When a user selects a CRM client (from the existing `clients` table), the system assembles a 360° intelligence view by fuzzy-matching the client name against all intelligence data sources.

**New Endpoint:**
```
GET /api/intelligence/client-profile/:clientId
```

**Response schema:**
```typescript
interface ClientIntelligenceProfile {
  client: {
    id: string;
    name: string;
    description: string | null;
    capabilities: string[];
  };

  // Matched LDA data (fuzzy match client.name → lda_client.name)
  lda: {
    matched: boolean;
    ldaClientId: number | null;
    confidence: number; // pg_trgm similarity score
    totalFilings: number;
    totalSpending: number | null;
    issueCodes: string[];
    recentFilings: LdaFiling[]; // last 10
    yearlySpend: { year: number; amount: number }[];
  };

  // Matched federal contractor (fuzzy match → federal_contractor)
  contracting: {
    matched: boolean;
    contractorName: string | null;
    totalContracts: number | null;
    rankByContracts: number | null;
    noBidTotal: number | null;
    topAgencies: { name: string; amount: number }[];
    yearlySpend: { year: number; amount: number }[];
  };

  // Matched lobby intel (fuzzy match → lobby_intel)
  lobbyIntel: {
    matched: boolean;
    trajectory: string | null; // exploding, steady, declining, new
    growthRate: number | null;
    totalSpending: number | null;
  };

  // Bills in the client's issue areas
  relevantBills: {
    total: number;
    bills: CongressBill[]; // top 10, sorted by latest action
  };

  // Regulations in the client's issue areas with open comment periods
  activeRegulations: {
    total: number;
    documents: FederalRegisterDoc[]; // open comment periods only
  };

  // Competitors: other entities lobbying on the same issue codes
  competitors: {
    topBySpend: { name: string; totalSpending: number; sharedIssues: string[] }[];
    newEntrants: { name: string; firstFilingDate: string; issues: string[] }[]; // last 90 days
  };

  // AI-generated summary (optional, populated by Phase 4)
  aiSummary: string | null;
  lastUpdated: string;
}
```

**Implementation notes:**
- Fuzzy matching uses the existing `pg_trgm` extension (already enabled) with `similarity()` function and a threshold of 0.3.
- The existing `matchCapiroClient` and `lookupByClientName` methods in lda-intel and federal-spending services are the starting point, extend them to return structured results.
- Issue code matching for bills and regulations: extract `issueCodes` from the client's LDA filings, then query `congress_bill` by `policyArea` mapping and `federal_register_document` by `agencyNames` overlap.
- Competitor detection: query `lda_filing` for other `client_id`s that share the same `issue_codes`, ranked by spending.
- Cache with 15-minute TTL (React Query staleTime), this is expensive to compute.

### 4.2 Cross-Source Change Detection

**What it does:** Detects meaningful changes across data sources since the last sync and generates structured change events.

**New Endpoint:**
```
GET /api/intelligence/changes?since=<ISO-date>&clientId=<optional>
```

**Response schema:**
```typescript
interface IntelligenceChange {
  id: string;
  source: 'lda' | 'congress' | 'regulations' | 'fec' | 'contracting';
  changeType: 'new_filing' | 'new_bill' | 'bill_action' | 'comment_deadline' |
              'spending_spike' | 'new_competitor' | 'trajectory_change' | 'new_regulation';
  severity: 'info' | 'notable' | 'critical';
  title: string;
  description: string;
  relatedClientIds: string[]; // Capiro CRM client IDs this affects
  relatedIssues: string[];    // LDA issue codes
  data: Record<string, unknown>; // source-specific payload
  detectedAt: string;
}
```

**Change detection rules:**

| Change Type | Source | Detection Logic | Severity |
|---|---|---|---|
| `new_filing` | LDA | New filing since last sync for a matched CRM client | info |
| `spending_spike` | LDA | Client's quarterly spend > 1.5x prior quarter | notable |
| `new_competitor` | LDA | New entity filing on same issue codes as a CRM client (first filing in last 90 days) | notable |
| `trajectory_change` | Lobby Intel | Client trajectory changed (e.g., steady → exploding) | notable |
| `new_bill` | Congress | New bill in a policy area matching a CRM client's issues | info |
| `bill_action` | Congress | Committee vote, floor vote, or presidential action on a tracked bill | critical |
| `comment_deadline` | Fed Register | Comment period opening or < 14 days to deadline on relevant regulation | critical if < 7d, notable if < 14d |
| `new_regulation` | Fed Register | New proposed rule or final rule in client's issue space | notable |

**Implementation:** Run as a post-sync step (appended to each sync script), not a separate cron job. Each sync script, after upserting data, calls `detectChanges(source, previousSyncTimestamp)` which queries for deltas and inserts rows into a new `intelligence_change` table.

### 4.3 Client-Issue Mapping

**What it does:** Maintains a resolved mapping between CRM clients and their government data identities across all sources.

**New table:** `client_intel_mapping`

```sql
CREATE TABLE client_intel_mapping (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id       UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  source          TEXT NOT NULL, -- 'lda', 'contracting', 'lobby_intel', 'fec'
  external_id     TEXT NOT NULL, -- the ID in the source table
  external_name   TEXT NOT NULL,
  confidence      REAL NOT NULL, -- pg_trgm similarity score
  confirmed       BOOLEAN DEFAULT false, -- user manually confirmed
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE (client_id, source, external_id)
);
```

**Resolution flow:**
1. On client create/update in CRM, run fuzzy match against all intelligence sources.
2. Auto-map if confidence >= 0.6, flag for review if 0.3 <= confidence < 0.6.
3. User can manually confirm/reject/override mappings via UI.
4. Once confirmed, mappings are stable, no re-resolution unless client name changes.

**Endpoints:**
```
GET    /api/intelligence/mappings/:clientId          , current mappings
POST   /api/intelligence/mappings/:clientId/resolve  , trigger re-resolution
PATCH  /api/intelligence/mappings/:mappingId         , confirm/reject
```

---

## 5. Phase 4, AI Insight Pipeline (New Feature)

### 5.1 Overview

Replace the stub `POST /insights/generate` with a real pipeline that generates actionable intelligence insights using the existing `EngagementAiService` infrastructure (OpenAI + Anthropic, with fallback).

### 5.2 Insight Generation Triggers

| Trigger | When | What Gets Generated |
|---|---|---|
| Post-sync | After any sync script completes | Change-based insights ("Spending on Healthcare lobbying surged 47% this quarter") |
| Scheduled | Daily at 6:00 AM ET | Per-client weekly briefings for active clients |
| On-demand | User clicks "Generate Insights" | Full analysis for a specific client or issue area |

### 5.3 Insight Categories

```typescript
type InsightCategory =
  | 'market_shift'        // macro trend in lobbying spend, issue surges
  | 'competitive_move'    // competitor started/stopped lobbying, spend change
  | 'regulatory_alert'    // new rule, comment deadline, significant action
  | 'legislative_signal'  // bill movement, committee action, vote
  | 'client_opportunity'  // client could benefit from a trend/connection
  | 'risk_flag';          // client exposure to declining issue, competitor surge
```

### 5.4 AI Prompt Architecture

Each insight generation call packages a structured context payload:

```typescript
interface InsightGenerationContext {
  // What data changed (from change detection)
  changes: IntelligenceChange[];

  // For client-specific insights
  clientProfile?: ClientIntelligenceProfile;

  // Market context
  surgingIssues: { code: string; name: string; surgePct: number }[];
  trendingTerms: string[];
  topSpenders: { name: string; spending: number; trajectory: string }[];

  // Instructions
  persona: string; // "You are a senior federal policy analyst..."
  outputFormat: 'insight_array'; // structured JSON output
}
```

**System prompt:**
```
You are a senior federal government affairs analyst at a top-tier lobbying firm. 
Generate actionable intelligence insights from the provided data. Each insight must:
1. State a specific, verifiable finding (not a generic observation)
2. Explain WHY it matters to a government affairs professional
3. Suggest a concrete next step (meeting, filing, outreach, monitoring)
4. Reference the specific data that supports the finding

Do not invent facts. Do not speculate beyond what the data supports.
If there is nothing notable, say so, do not manufacture urgency.
```

**Output schema:**
```typescript
interface GeneratedInsight {
  category: InsightCategory;
  title: string;     // max 80 chars, specific
  body: string;      // 2-3 sentences, actionable
  severity: 'info' | 'notable' | 'critical';
  dataPoints: {
    source: string;  // which data source
    metric: string;  // what was measured
    value: string;   // the finding
  }[];
  suggestedAction: string;
  relatedClientIds: string[];
  relatedIssueCodes: string[];
  expiresAt: string; // ISO date, typically 7 days for trends, 1 day for deadlines
}
```

### 5.5 Storage

Use the existing `intelligence_insight` table (already in Prisma schema). Extend it:

```sql
ALTER TABLE intelligence_insight
  ADD COLUMN change_ids   UUID[] DEFAULT '{}',
  ADD COLUMN client_ids   UUID[] DEFAULT '{}',
  ADD COLUMN issue_codes  TEXT[] DEFAULT '{}',
  ADD COLUMN action       TEXT,
  ADD COLUMN provider     TEXT,
  ADD COLUMN model        TEXT;
```

### 5.6 Rate Limiting & Cost Control

- Max 50 insights generated per sync cycle
- Max 20 insights per client per day
- Use `gpt-4o-mini` / `claude-3.5-haiku` for bulk insight generation (cheap, fast)
- Use `gpt-4o` / `claude-sonnet` for on-demand single-client deep analysis
- Estimated cost: ~$2-5/day for daily generation across all clients

### 5.7 Integration with Existing AI

The `EngagementAiService.buildFederalContextBlock()` already injects lobby intel into email/meeting prep prompts. The insight pipeline feeds the same data in the opposite direction:

- **Current flow:** Intelligence data → AI context → email/meeting prep
- **New flow:** Intelligence data → AI analysis → insights table → InsightsBanner + client briefings
- **Shared:** Both use `lobbyIntel.getAiContext()` and `federalSpending.getAiContext()`

---

## 6. Database Changes

### 6.1 New Tables

```sql
-- Phase 3: Client-to-intelligence source mapping
CREATE TABLE client_intel_mapping (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id       UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  source          TEXT NOT NULL,
  external_id     TEXT NOT NULL,
  external_name   TEXT NOT NULL,
  confidence      REAL NOT NULL,
  confirmed       BOOLEAN DEFAULT false,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE (client_id, source, external_id)
);
CREATE INDEX idx_cim_client ON client_intel_mapping(client_id);
CREATE INDEX idx_cim_source ON client_intel_mapping(source, external_id);

-- Phase 3: Cross-source change events
CREATE TABLE intelligence_change (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source            TEXT NOT NULL,
  change_type       TEXT NOT NULL,
  severity          TEXT NOT NULL DEFAULT 'info',
  title             TEXT NOT NULL,
  description       TEXT NOT NULL,
  related_client_ids UUID[] DEFAULT '{}',
  related_issues    TEXT[] DEFAULT '{}',
  data              JSONB DEFAULT '{}',
  detected_at       TIMESTAMPTZ DEFAULT now(),
  consumed          BOOLEAN DEFAULT false
);
CREATE INDEX idx_ic_detected ON intelligence_change(detected_at DESC);
CREATE INDEX idx_ic_source ON intelligence_change(source, change_type);
CREATE INDEX idx_ic_clients ON intelligence_change USING gin(related_client_ids);
```

### 6.2 Altered Tables

```sql
-- Phase 4: Extend intelligence_insight
ALTER TABLE intelligence_insight
  ADD COLUMN IF NOT EXISTS change_ids  UUID[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS client_ids  UUID[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS issue_codes TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS action      TEXT,
  ADD COLUMN IF NOT EXISTS provider    TEXT,
  ADD COLUMN IF NOT EXISTS model       TEXT;

CREATE INDEX idx_ii_clients ON intelligence_insight USING gin(client_ids);
CREATE INDEX idx_ii_issues ON intelligence_insight USING gin(issue_codes);
```

### 6.3 Performance Indexes (Bug Fix 2.7)

```sql
CREATE INDEX CONCURRENTLY idx_lda_filing_client_name_trgm
  ON lda_filing USING gin (client_name gin_trgm_ops);
CREATE INDEX CONCURRENTLY idx_lda_filing_registrant_name_trgm
  ON lda_filing USING gin (registrant_name gin_trgm_ops);
CREATE INDEX CONCURRENTLY idx_lda_filing_issue_codes_gin
  ON lda_filing USING gin (issue_codes);
```

---

## 7. API Contract

### 7.1 New Endpoints (Phase 3 & 4)

```
# Client Intelligence Profile
GET /api/intelligence/client-profile/:clientId
  → ClientIntelligenceProfile

# Cross-source changes
GET /api/intelligence/changes?since=<ISO>&clientId=<optional>&source=<optional>
  → { data: IntelligenceChange[], total: number }

# Client-intel mappings
GET    /api/intelligence/mappings/:clientId
POST   /api/intelligence/mappings/:clientId/resolve
PATCH  /api/intelligence/mappings/:mappingId
  Body: { confirmed: boolean }

# AI insights (replaces stub)
POST   /api/intelligence/insights/generate
  Body: { clientId?: string, scope: 'all' | 'client' | 'issue', issueCode?: string }
  → { insights: GeneratedInsight[], provider: string, model: string }

GET    /api/intelligence/insights?clientId=<optional>&category=<optional>&severity=<optional>
  → { data: IntelligenceInsight[], total: number }

# Client weekly briefing
GET    /api/intelligence/briefing/:clientId
  → { briefing: string, generatedAt: string, dataPoints: {...}[] }

# Regulatory dockets (Bug Fix 2.3)
GET    /api/regulatory-dockets?page&limit&agency&type
GET    /api/regulatory-dockets/upcoming-deadlines
GET    /api/regulatory-dockets/:documentId
```

### 7.2 Modified Endpoints

```
# Congress bills, add activeSince param (Bug Fix 2.4)
GET /api/lda-intel/congress/bills?q&policyArea&congress&page&limit&activeSince
```

### 7.3 New NestJS Module

```
apps/api/src/intelligence/
├── intelligence.module.ts
├── intelligence.controller.ts
├── intelligence.service.ts          # client profiles, mappings, changes
├── insight-generator.service.ts     # AI insight generation pipeline
├── change-detector.service.ts       # post-sync change detection
└── dto/
    ├── generate-insights.dto.ts
    ├── changes-query.dto.ts
    └── mapping-update.dto.ts
```

This module imports `LdaIntelModule`, `LobbyIntelModule`, `FederalSpendingModule`, `FederalRegisterModule`, and the new `RegulatoryDocketModule`.

---

## 8. Frontend UX Specifications

### 8.1 Updated Intelligence Center Tab Layout

The existing 10 tabs remain. Three new additions:

**New: "My Clients" tab (first position)**
- Dropdown to select a CRM client
- Shows the `ClientIntelligenceProfile` response:
  - Hero cards: trajectory, total spend, rank, active issues count
  - "What's New" section: changes from last 7 days affecting this client
  - LDA filing history with sparkline
  - Relevant bills (expandable)
  - Active regulations with deadline urgency
  - Competitor landscape (who else lobbies on these issues)
  - AI summary (if generated)
- Action buttons: "Generate Briefing", "Draft Outreach", "View Filings"

**Updated: InsightsBanner (top of page)**
- Currently reads from `intelligence_insight` table (likely empty)
- After Phase 4: populated with AI-generated insights
- Filter by: All, My Clients (only insights with client_ids matching user's tenant)
- Click an insight → deep link to relevant tab/client

**New: "Changes" sidebar or sub-tab**
- Chronological feed of `intelligence_change` events
- Filterable by source, severity, client
- Badge count on the Intelligence nav item showing unread critical/notable changes

### 8.2 Client Intelligence Profile Page

```
┌─────────────────────────────────────────────────────────────┐
│ [Client Selector Dropdown]                    [Generate Briefing] │
├────────────┬────────────┬────────────┬────────────┐         │
│ Trajectory │ Total Spend│ Filing Rank│ Issues     │         │
│ 🔥 Exploding│ $4.2M/yr  │ #47        │ 6 active   │         │
├────────────┴────────────┴────────────┴────────────┘         │
│                                                             │
│ ┌─ What's New (7 days) ──────────────────────────────────┐ │
│ │ 🔴 Comment deadline in 5d: EPA Proposed Rule on...     │ │
│ │ 🟡 New competitor: XYZ Corp started lobbying on HCR    │ │
│ │ ⚪ 2 new filings by your client this quarter           │ │
│ └────────────────────────────────────────────────────────┘ │
│                                                             │
│ ┌─ Lobbying Landscape ─────┐ ┌─ Relevant Legislation ────┐ │
│ │ Issue areas (bar chart)  │ │ Bills in client's issues  │ │
│ │ Yearly spend sparkline   │ │ Sorted by latest action   │ │
│ │ Top firms representing   │ │ Expandable detail rows    │ │
│ └──────────────────────────┘ └───────────────────────────┘ │
│                                                             │
│ ┌─ Regulatory Exposure ────┐ ┌─ Competitive Landscape ───┐ │
│ │ Open comment periods     │ │ Top 10 competitors by     │ │
│ │ Deadline urgency cards   │ │ spend on shared issues    │ │
│ │ Relevant proposed rules  │ │ New entrants (90 days)    │ │
│ └──────────────────────────┘ └───────────────────────────┘ │
│                                                             │
│ ┌─ AI Briefing ──────────────────────────────────────────┐ │
│ │ "Your client's lobbying spend increased 23% QoQ,       │ │
│ │  driven by 3 new Healthcare filings. Competitor ABC    │ │
│ │  Corp entered the HCR space for the first time.        │ │
│ │  EPA-2026-0142 has a comment deadline in 5 days,      │ │
│ │  consider filing a comment on behalf of the client."   │ │
│ └────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

### 8.3 Design Constraints

- Use existing Ant Design component library (already in project)
- Follow existing visual patterns: color-coded severity, sparklines, HBar charts, Tag components
- Maintain existing dark-on-light color scheme
- All new panels follow the same error/loading/empty state patterns as existing tabs

---

## 9. Deployment Sequence

### 9.1 Order of Operations

```
Phase 1: Bug Fixes (no downtime, backward compatible)
  1. Fix FEC sync (sync-fec.ts: create → upsert)
  2. Register sync:regulations in package.json
  3. Fix SYNC_YEARS to be dynamic
  4. Fix Prisma OR syntax in getInsights()
  5. Fix antd bodyStyle deprecation
  6. Fix Filings panel raw buttons → Pagination
  7. Deploy Prisma migration: GIN trigram indexes
  8. Add activeSince to CongressBillsQueryDto + service
  9. Build + push API image
  10. Build + push Web image
  11. ECS force new deployment

Phase 2: Frontend Decomposition (no API changes)
  1. Extract types.ts, utils.ts
  2. Extract each panel into separate file
  3. Verify no regressions (same API calls, same rendering)
  4. Build + push Web image only
  5. ECS force new deployment (web service)

Phase 3: Synthesis Layer (new API endpoints + DB migration)
  1. Prisma migration: client_intel_mapping + intelligence_change tables
  2. Build intelligence NestJS module (controller, service, DTOs)
  3. Build regulatory-docket NestJS module
  4. Add change detection to sync scripts (post-sync hook)
  5. Build "My Clients" frontend tab
  6. Build + push both images
  7. ECS migration task
  8. ECS force new deployment

Phase 4: AI Insight Pipeline (new service + AI calls)
  1. Prisma migration: extend intelligence_insight table
  2. Build insight-generator.service.ts
  3. Wire up post-sync insight generation
  4. Update InsightsBanner to show real insights
  5. Add "Generate Briefing" button + client briefing view
  6. Build + push both images
  7. ECS migration task
  8. ECS force new deployment
```

### 9.2 Environment Variables (Phase 4)

Already configured in ECS task definitions:
- `OPENAI_API_KEY`, used by EngagementAiService
- `ANTHROPIC_API_KEY`, used by EngagementAiService
- `AI_PROVIDER`, preferred provider selection
- `OPENAI_MODEL` / `ANTHROPIC_MODEL`, model selection

New (optional):
- `INSIGHT_GENERATION_ENABLED=true`, feature flag
- `INSIGHT_MAX_PER_SYNC=50`, cost control
- `INSIGHT_MODEL_OPENAI=gpt-4o-mini`, cheaper model for bulk generation
- `INSIGHT_MODEL_ANTHROPIC=claude-3-5-haiku-latest`

### 9.3 Rollback Plan

Each phase is independently deployable and reversible:
- Phase 1: Bug fixes are all backward compatible. Rollback = previous image tag.
- Phase 2: Frontend only. Rollback = previous web image tag.
- Phase 3: New endpoints don't affect existing ones. Rollback = previous API image + migration rollback.
- Phase 4: Feature-flagged. Disable with `INSIGHT_GENERATION_ENABLED=false`.

---

## 10. Testing Requirements

### 10.1 Phase 1 Tests

- [ ] FEC sync: run twice, assert contribution count unchanged
- [ ] sync:regulations: verify pnpm script executes
- [ ] Congress "Active Bills": toggle filter, verify different result count
- [ ] SYNC_YEARS: verify array includes current year dynamically
- [ ] GIN indexes: verify EXPLAIN ANALYZE uses index scan for ILIKE queries

### 10.2 Phase 2 Tests

- [ ] TypeScript compilation: `tsc --noEmit` passes
- [ ] Visual regression: all 10 tabs render identically to before decomposition
- [ ] No duplicate API calls (React Query keys unchanged)

### 10.3 Phase 3 Tests

- [ ] Client profile endpoint returns valid data for a known CRM client
- [ ] Fuzzy match: "Raytheon Technologies" matches "RAYTHEON TECHNOLOGIES CORP" in LDA data
- [ ] Change detection: insert a new filing, verify change event generated
- [ ] Mapping CRUD: create, confirm, reject, re-resolve
- [ ] Regulatory dockets: paginated listing, deadline query

### 10.4 Phase 4 Tests

- [ ] Insight generation: mock AI provider, verify structured output saved to DB
- [ ] InsightsBanner: displays real insights when table has data
- [ ] Cost control: verify max insights per sync honored
- [ ] Provider fallback: if OpenAI fails, Anthropic takes over (existing pattern)
- [ ] Feature flag: `INSIGHT_GENERATION_ENABLED=false` skips generation

---

## Appendix: Files Modified per Phase

### Phase 1
```
apps/api/scripts/sync-fec.ts                           # create → upsert
apps/api/scripts/sync-lda.ts                            # dynamic SYNC_YEARS
apps/api/package.json                                    # add sync:regulations
apps/api/src/lda-intel/lda-intel.controller.ts          # activeSince DTO
apps/api/src/lda-intel/lda-intel.service.ts             # activeSince filter + OR fix
apps/api/prisma/migrations/NNNN_gin_indexes/migration.sql  # new migration
apps/web/src/pages/intelligence/IntelligenceCenterPage.tsx  # bodyStyle + pagination
```

### Phase 2
```
apps/web/src/pages/intelligence/IntelligenceCenterPage.tsx  # gutted to ~100 lines
apps/web/src/pages/intelligence/types.ts                     # new
apps/web/src/pages/intelligence/utils.ts                     # new
apps/web/src/pages/intelligence/InsightsBanner.tsx           # new
apps/web/src/pages/intelligence/BillDetailRow.tsx            # new
apps/web/src/pages/intelligence/panels/*.tsx                 # 10 new files
```

### Phase 3
```
apps/api/src/intelligence/                                   # new module (6 files)
apps/api/src/regulatory-docket/                              # new module (3 files)
apps/api/scripts/sync-*.ts                                   # post-sync hooks (7 files)
apps/api/prisma/migrations/NNNN_synthesis_layer/migration.sql
apps/web/src/pages/intelligence/panels/ClientProfilePanel.tsx  # new
apps/web/src/pages/intelligence/IntelligenceCenterPage.tsx     # add tab
```

### Phase 4
```
apps/api/src/intelligence/insight-generator.service.ts       # new
apps/api/prisma/migrations/NNNN_insight_extensions/migration.sql
apps/web/src/pages/intelligence/InsightsBanner.tsx           # updated
apps/web/src/pages/intelligence/panels/ClientProfilePanel.tsx # add briefing
```
