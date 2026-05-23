# Phase 0: Prove What You Have — Implementation Plan

> **For Hermes:** Dispatch to Claude Code in 4 sequential invocations.

**Goal:** Make the 14 populated data tables visible to users through entity resolution, a changes inbox, client intelligence profiles, and portfolio schema changes.

**Codebase:** `/c/Users/neoma/OneDrive/Documents/Claude/Projects/capirov2/git/capirov2`
**Stack:** NestJS API (apps/api), React + AntD frontend (apps/web), Prisma ORM, Aurora Postgres with pg_trgm + pgvector

---

## PHASE 0.1 — Entity Resolution Backfill + Review UI (API-side)

### Context
- `ClientIntelMapping` table EXISTS in schema (id, clientId, source, externalId, externalName, confidence, confirmed)
- `intelligence.service.ts` already has `fuzzyMatchLda()`, `fuzzyMatchContractor()`, `fuzzyMatchLobbyIntel()` using `similarity()` from pg_trgm
- GIN trigram indexes already exist on lda_client, federal_contractor, lobby_intel tables
- What's MISSING: a batch job to run entity resolution for ALL clients and persist results to client_intel_mapping, plus SEC filings, FEC, BLS, Census, GAO cross-references
- What's MISSING: a review UI in Settings for tenants to confirm/reject proposed mappings

### Tasks

**A. Entity Resolution Batch Service** (`apps/api/src/intelligence/entity-resolution.service.ts`)
Create a new service that:
1. Queries all Client records for a given tenant (via prisma.withTenant)
2. For each client, runs fuzzy matching against: lda_client (name), federal_contractor (name), sec_filing (company_name), fec_contribution (contributor_employer — distinct values), fara_registration (registrant_name)
3. Auto-confirms matches with confidence >= 0.85
4. Stores all matches (including low-confidence) to client_intel_mapping via upsert on (clientId, source, externalId)
5. Returns summary: { total_clients, mappings_created, auto_confirmed, needs_review }

Use the SAME pg_trgm similarity() pattern that already exists in intelligence.service.ts. Add new sources: 'sec', 'fec_employer', 'fara'.

**B. Entity Resolution Controller Endpoint** (`apps/api/src/intelligence/intelligence.controller.ts`)
- POST /intelligence/resolve-all — triggers batch resolution for the tenant. Returns summary.
- GET /intelligence/mappings — returns all ClientIntelMapping for the tenant, grouped by client. Include client name.
- PATCH /intelligence/mappings/:id — confirm or reject a mapping (sets confirmed = true/false)

**C. Prisma Schema Updates** (apps/api/prisma/schema.prisma)
- Add new fields to Client model: `sectorTag String? @map("sector_tag")` and `profileType String? @map("profile_type") @default("CLIENT")`
- Add migration for these new columns

**D. Intelligence Changes Post-Sync Hook** (`apps/api/scripts/`)
- Modify the sync-all shell script to emit IntelligenceChange rows after each sync completes
- Create a helper: `apps/api/scripts/emit-changes.ts` that compares current vs previous row counts per source table and writes IntelligenceChange rows for new/modified entries
- Sources to track: sec_filing, congress_bill, federal_register_document, federal_grant, gao_report, intel_article, committee_hearing, state_bill

---

## PHASE 0.2 — Changes Inbox + Client Intelligence Profile (Frontend)

### Context
- IntelligenceChange table exists and will be populated by Phase 0.1D
- ClientIntelMapping will be populated by Phase 0.1A
- Intelligence frontend exists at apps/web/src/pages/intelligence/ with panels for LDA, Congress, Contracting, Regulations, etc.
- ClientProfilePanel.tsx already exists but only shows basic data

### Tasks

**E. Changes Inbox Page** (`apps/web/src/pages/intelligence/ChangesInboxPage.tsx`)
- New route: /intelligence/changes
- AntD Table showing IntelligenceChange rows, sorted by detectedAt DESC
- Columns: severity (Tag color), source (Tag), title, description (truncated), detectedAt (relative time)
- Filters: source dropdown (multi-select), severity dropdown, date range
- Click row → expand to show full description + data JSON
- Unread badge on nav item (count where consumed = false)
- Mark-as-read on click (PATCH consumed = true)

**F. Client Intelligence Profile Page Enhancement** (`apps/web/src/pages/intelligence/panels/ClientProfilePanel.tsx`)
- When a client has confirmed ClientIntelMapping entries, show tabbed sections:
  - LDA tab: filing history, issue codes, registrants, lobbyists (from LdaFiling via mapping)
  - Contracts tab: federal_contractor awards, total obligations (from FederalContractor via mapping)
  - SEC tab: recent filings (from SecFiling via mapping)
  - Bills tab: auto-matched bills based on issue codes from LDA mapping → CongressBillSubject
  - News tab: related intel_article entries (keyword match on client name)
  - FEC tab: contributions linked to client's lobbyists/employer name
- Each tab shows a count badge
- Hero stats row at top: total lobbying spend (LDA), total contracts won, active bills tracked, engagement health score (placeholder 0-100)

**G. Mappings Review UI** (`apps/web/src/pages/settings/IntelligenceMappingsPage.tsx`)
- New route: /settings/intelligence-mappings  
- Table grouped by client, showing all proposed mappings
- Columns: source, externalName, confidence (Progress bar), confirmed (Switch)
- Bulk actions: confirm all >= 0.85, reject all < 0.5
- "Resolve All" button that calls POST /intelligence/resolve-all

**H. Navigation Updates**
- Add "Changes Inbox" to sidebar under Intelligence section with unread badge
- Add "Intelligence Mappings" to Settings page
- Update Client detail view to show intelligence tab when mappings exist

---

## PHASE 0.3 — Portfolio Tab Schema Changes (API)

### Context
- Per the Portfolio Tab v2 spec, the Client model needs new fields
- This is a pure schema + migration + API update

### Tasks

**I. Prisma Schema Migration**
Add to Client model:
```prisma
accountType       String?   @map("account_type")        // LOBBYING_FIRM, INHOUSE_GA
profileType       String?   @map("profile_type")         // CLIENT, PROGRAM  
sectorTag         String?   @map("sector_tag")           // DEFENSE, HEALTH, ENERGY, etc.
submissionTracks  String[]  @map("submission_tracks")     // NDAA, APPROPRIATIONS, CDS, etc.
profileStatus     String    @default("ACTIVE") @map("profile_status") // ACTIVE, PAUSED, MONITORING, ARCHIVED
```

Add to Tenant model:
```prisma
accountType   String?   @map("account_type")   // LOBBYING_FIRM, INHOUSE_GA
planTier      String    @default("FOUNDATION") @map("plan_tier") // FOUNDATION, GROWTH, ENTERPRISE
```

**J. Update Client CRUD Endpoints**
- Include new fields in create/update DTOs
- Add validation for enum values
- Update the clients list endpoint to support filtering by profileStatus, sectorTag

**K. Update Client Create/Edit Forms (Frontend)**
- Add sectorTag dropdown (11 values) to client create/edit form
- Add profileType selector (CLIENT vs PROGRAM)
- Add submissionTracks multi-select
- Add profileStatus dropdown
- Conditionally show fields based on accountType

---

## PHASE 0.4 — Cross-Reference Endpoints (API)

### Context  
- These are pure SQL joins on existing tables, exposed as new API endpoints
- No new tables needed

### Tasks

**L. Cross-Reference Endpoints** (add to intelligence.controller.ts or new file)
- GET /intelligence/clients/:id/lobbying-roi — Join LDA filing income vs FederalContractor obligations via ClientIntelMapping
- GET /intelligence/clients/:id/fec-flow — FEC contributions where employer matches client (via mapping)  
- GET /intelligence/clients/:id/competitor-board — Other LDA registrants filing on same issue codes
- GET /intelligence/clients/:id/bills — Bills matched via issue code overlap from LDA filings
- GET /intelligence/clients/:id/ex-staffers — LDA lobbyists with covered_positions for this client's registrant

Each endpoint returns structured JSON. All use existing data. Pure joins.

---

## Implementation Order
1. Phase 0.1 (A-D) — API: Entity resolution + changes hook — Claude Code invocation 1
2. Phase 0.3 (I-K) — Schema changes + CRUD — Claude Code invocation 2  
3. Phase 0.2 (E-H) — Frontend: Changes Inbox + Profile + Mappings UI — Claude Code invocation 3
4. Phase 0.4 (L) — API: Cross-reference endpoints — Claude Code invocation 4

## Files Likely Changed
### API (apps/api/):
- NEW: src/intelligence/entity-resolution.service.ts
- NEW: scripts/emit-changes.ts  
- MODIFY: src/intelligence/intelligence.service.ts
- MODIFY: src/intelligence/intelligence.controller.ts
- MODIFY: src/intelligence/intelligence.module.ts
- MODIFY: prisma/schema.prisma (+ new migration)
- MODIFY: src/clients/clients.service.ts
- MODIFY: src/clients/clients.controller.ts

### Frontend (apps/web/):
- NEW: src/pages/intelligence/ChangesInboxPage.tsx
- NEW: src/pages/settings/IntelligenceMappingsPage.tsx
- MODIFY: src/pages/intelligence/panels/ClientProfilePanel.tsx
- MODIFY: navigation/sidebar configuration
- MODIFY: route definitions
