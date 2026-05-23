# Phase 0.1: Entity Resolution Service + Portfolio Schema + IntelligenceChange Emitter

## YOUR TASK
Implement the three foundational backend pieces from the Capiro Master Strategy Report (Sections 2.3, 4.2, 10.1). Read existing code FIRST to match patterns exactly.

---

## PART A: Entity Resolution Service v1

Per Strategy Report Section 4.2, Capiro has **seven different identifiers** for the same real-world entity:
1. `clients.name` (CRM — tenant-scoped)
2. `lda_client.name` (LDA filings)  
3. `lda_filing.client_name` (redundant with lda_client but sometimes different)
4. `federal_contractor.name` (USAspending)
5. `fec_contribution.contributor_employer` (FEC — use SELECT DISTINCT)
6. `sec_filing.company_name` (SEC EDGAR — tied to CIK, the gold key)
7. `fara_registration.registrant_name` (Foreign Agents)

The report specifies a **five-stage resolution pipeline**, but for v1 (Q3 scope per Section 10.1) we implement Stages A-D only:

**Stage A — String blocking**: Use `pg_trgm` + GIN indexes (ALREADY enabled — see migration `20260521120000_gin_trigram_indexes`) to retrieve top-50 candidates per CRM client from each source. Use `similarity(name, $clientName) > 0.3` — this exact pattern ALREADY exists in `apps/api/src/intelligence/intelligence.service.ts` methods `fuzzyMatchLda()`, `fuzzyMatchContractor()`, `fuzzyMatchLobbyIntel()`. READ THOSE METHODS FIRST.

**Stage B — Fingerprinting**: Normalize names before matching — lowercase, strip common suffixes (Inc, LLC, Corp, Ltd, Co, LP, LLP, PA, PC, PLLC, Group, Holdings, International, Associates, Partners, Consulting, Services, Solutions, Technologies, Enterprises), strip punctuation, collapse whitespace. Compare fingerprinted versions for pairs that score 0.3-0.6 on raw similarity.

**Stage C — Confidence scoring**: Combine trigram similarity (primary signal) with secondary signals where available:
- Exact CIK match (sec_filing.cik vs any known CIK for the client) → boost confidence to 0.95
- Address overlap (if both records have state/address fields) → +0.1 
- Lobbyist co-occurrence in LDA (same lobbyist appears in filings for both names) → +0.1

**Stage D — Human-in-the-loop thresholds**:
- Auto-confirm ≥ 0.85 → set `client_intel_mapping.confirmed = true`
- Review queue 0.5–0.85 → store with `confirmed = false`  
- Below 0.5 → store but mark `confirmed = false` (user can still see and confirm)

### Create: `apps/api/src/intelligence/entity-resolution.service.ts`

```
@Injectable() EntityResolutionService
  constructor(private prisma: PrismaService)

  async resolveAllForTenant(tenantId: string): Promise<ResolutionSummary>
    - Get all clients via prisma.withTenant(tenantId, tx => tx.client.findMany({include: {capabilities: true}}))
    - For each client, run resolveClient()
    - Return { totalClients, mappingsCreated, autoConfirmed, needsReview }

  async resolveClient(clientId: string, clientName: string): Promise<void>
    - Fingerprint the client name
    - Run parallel fuzzy matches against all 6 external sources (lda_client, federal_contractor, sec_filing, fec employer, fara_registration, lobby_intel)
    - Score each candidate using Stage C logic
    - Upsert results to client_intel_mapping with (clientId, source, externalId) as unique key
    - Auto-confirm >= 0.85

  private fingerprint(name: string): string
    - lowercase, strip suffixes, strip punctuation, collapse whitespace

  private async matchSource(fingerprinted: string, raw: string, source: string): Promise<CandidateMatch[]>
    - Use $queryRawUnsafe with pg_trgm similarity() — same pattern as existing fuzzyMatchLda
    - Sources: 'lda' → lda_client, 'contracting' → federal_contractor, 'sec' → sec_filing, 'fec_employer' → (SELECT DISTINCT contributor_employer FROM fec_contribution), 'fara' → fara_registration, 'lobby_intel' → lobby_intel
```

Register in `intelligence.module.ts` as a provider.

### Add controller endpoints to `intelligence.controller.ts`:

- `POST /intelligence/resolve-all` — calls resolveAllForTenant(req.tenantId). Requires auth (@UseGuards). Returns ResolutionSummary.
- `GET /intelligence/mappings` — returns all ClientIntelMapping for the tenant's clients. Group by clientId. Include client name via join.
- `PATCH /intelligence/mappings/:id` — body: { confirmed: boolean }. Updates the mapping.
- `GET /intelligence/clients/:clientId/profile` — the full 360° client intelligence profile. This ALREADY exists as `getClientProfile()` in intelligence.service.ts. Enhance it to use confirmed mappings from client_intel_mapping instead of re-running fuzzy match every time.

---

## PART B: Portfolio Tab v2 Schema Changes

Per Strategy Report Section 2.3, add these fields:

### Client model additions:
```prisma
profileType       String?   @map("profile_type")         // CLIENT or PROGRAM
sectorTag         String?   @map("sector_tag")           // 11 values: DEFENSE, HEALTH, ENERGY, TRANSPORTATION, AGRICULTURE, HOMELAND_SECURITY, ENVIRONMENT_WATER, COMMERCE_TECH, EDUCATION, FINANCIAL_SERVICES, OTHER
submissionTracks  String[]  @map("submission_tracks") @default([])  // NDAA, APPROPRIATIONS, CDS, AUTHORIZATION, ADVOCACY
profileStatus     String    @default("ACTIVE") @map("profile_status")  // ACTIVE, PAUSED, MONITORING, ARCHIVED
```

### Tenant model additions:
```prisma
accountType   String?   @map("account_type")   // LOBBYING_FIRM or INHOUSE_GA
planTier      String    @default("FOUNDATION") @map("plan_tier") // FOUNDATION, GROWTH, ENTERPRISE
```

Create a Prisma migration: `npx prisma migrate dev --name portfolio_tab_v2_schema`

Update the Client create/update DTOs and service to include these new fields.
Update the Client list endpoint to support filtering by `profileStatus` and `sectorTag`.

---

## PART C: IntelligenceChange Emitter Script

Per Strategy Report Section 4.1: "Make every sync emit IntelligenceChange events as a post-sync step. Today only some do. This is the seam where 'data refreshed' becomes 'product feature'."

Also per Section 4.1: "Emit a SyncRun row per execution (source, started_at, finished_at, rows_inserted, rows_updated, error_count)."

### Create: `apps/api/scripts/emit-changes.ts`
Standalone script: `npx tsx scripts/emit-changes.ts`

- Connects to DB via PrismaClient
- For each source table that has a `syncedAt` or date field:
  - sec_filing (syncedAt), congress_bill (syncedAt), federal_register_document (syncedAt), federal_grant (syncedAt), gao_report (syncedAt), intel_article (syncedAt), committee_hearing (syncedAt), state_bill (syncedAt), bls_data_point (seriesId group), bea_data, census_district, fec_contribution, lda_filing
- Counts rows where syncedAt/createdAt > NOW() - INTERVAL '24 hours'
- For each table with new rows, writes an IntelligenceChange record:
  - source: table name (e.g., 'sec_filing', 'congress_bill')
  - changeType: 'new_data'
  - severity: count > 100 → 'notable', count > 1000 → 'critical', else 'info'
  - title: 'N new [human-readable source name] records synced'
  - description: summary (e.g., "12 new SEC filings detected across 8 companies")
  - relatedClientIds: [] (populated later by entity resolution)
  - relatedIssues: [] (populated later)
  - data: { count, table, sample_ids: first 5 new row IDs }

### Add SyncRun model to schema.prisma:
```prisma
model SyncRun {
  id           String   @id @default(uuid()) @db.Uuid
  source       String
  startedAt    DateTime @map("started_at") @db.Timestamptz(6)
  finishedAt   DateTime? @map("finished_at") @db.Timestamptz(6)
  rowsInserted Int      @default(0) @map("rows_inserted")
  rowsUpdated  Int      @default(0) @map("rows_updated")
  errorCount   Int      @default(0) @map("error_count")
  status       String   @default("running") // running, completed, failed
  errorMessage String?  @map("error_message") @db.Text

  @@index([source, startedAt(sort: Desc)])
  @@map("sync_run")
}
```

Include this in the same migration as Part B.

---

## CRITICAL IMPLEMENTATION RULES

1. **READ existing files FIRST**: intelligence.service.ts, intelligence.controller.ts, intelligence.module.ts, prisma.service.ts (for withTenant pattern), clients.service.ts, clients.controller.ts
2. **RLS pattern**: `prisma.withTenant(tenantId, (tx) => tx.model.findMany(...))` for ALL tenant-scoped tables (Client, Meeting, etc.). Direct `prisma.model.findMany` for GLOBAL tables (sec_filing, congress_bill, etc.)
3. **Type pattern**: Use `Record<string, unknown>` for dynamic where clauses, NOT `Parameters<typeof this.prisma.X.findMany>[0]['where']`
4. **Auth pattern**: Match the existing auth guard pattern in intelligence.controller.ts
5. **Do NOT use conditional spread `...(cond ? {x} : {})` in Prisma update calls** — it breaks Prisma XOR types in Docker. Use explicit if-assignments.
6. **Run the Prisma migration** after schema changes
7. **Register new services** in intelligence.module.ts
