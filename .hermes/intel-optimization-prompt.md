## INTELLIGENCE CENTER OPTIMIZATION — Implementation Prompt

### CONTEXT
Capiro monorepo: NestJS API (apps/api/), React+AntDesign web (apps/web/).
Prisma ORM, PostgreSQL, ECS Fargate deployments.

The Intelligence Center is at apps/web/src/pages/intelligence/IntelligenceCenterPage.tsx (1,557 lines).
API modules: lda-intel, federal-spending, lobby-intel (each has controller, service, module).
Sync scripts: apps/api/scripts/sync-{lda,fec,congress,openlobby,openspending}.ts

### READ FIRST
- apps/web/src/pages/intelligence/IntelligenceCenterPage.tsx (full file)
- apps/api/src/lda-intel/lda-intel.service.ts
- apps/api/src/lda-intel/lda-intel.controller.ts
- apps/api/src/federal-spending/federal-spending.service.ts
- apps/api/src/lobby-intel/lobby-intel.service.ts
- apps/api/prisma/schema.prisma (search for Lda, Fec, Congress, Federal, Lobby models)
- apps/api/scripts/sync-congress.ts
- apps/api/scripts/sync-lda.ts

### CHANGES TO IMPLEMENT

#### A. SCHEMA: New tables for expanded data

Add to prisma/schema.prisma:

```prisma
model FederalRegisterDocument {
  id              String   @id @default(uuid())
  documentNumber  String   @unique @map("document_number")
  type            String   // RULE, PROPOSED_RULE, NOTICE, PRESIDENTIAL_DOCUMENT
  title           String   @db.Text
  abstract        String?  @db.Text
  agencyNames     String[] @map("agency_names")
  publicationDate DateTime @map("publication_date")
  commentEndDate  DateTime? @map("comment_end_date")
  effectiveDate   DateTime? @map("effective_date")
  docketIds       String[] @map("docket_ids")
  cfrReferences   String[] @map("cfr_references")
  htmlUrl         String?  @map("html_url")
  pdfUrl          String?  @map("pdf_url")
  topics          String[]
  significantRule Boolean  @default(false) @map("significant_rule")
  syncedAt        DateTime @default(now()) @map("synced_at")

  @@index([type, publicationDate])
  @@index([commentEndDate])
  @@map("federal_register_document")
}

model CongressBillAction {
  id        String   @id @default(uuid())
  billId    String   @map("bill_id")
  date      DateTime
  text      String   @db.Text
  type      String?
  chamber   String?
  bill      CongressBill @relation(fields: [billId], references: [id], onDelete: Cascade)

  @@index([billId, date])
  @@map("congress_bill_action")
}

model CongressBillCommittee {
  id            String @id @default(uuid())
  billId        String @map("bill_id")
  committeeName String @map("committee_name")
  committeeCode String? @map("committee_code")
  chamber       String?
  bill          CongressBill @relation(fields: [billId], references: [id], onDelete: Cascade)

  @@index([billId])
  @@index([committeeCode])
  @@map("congress_bill_committee")
}

model CongressBillSubject {
  id     String @id @default(uuid())
  billId String @map("bill_id")
  name   String
  bill   CongressBill @relation(fields: [billId], references: [id], onDelete: Cascade)

  @@index([billId])
  @@index([name])
  @@map("congress_bill_subject")
}

model IntelligenceInsight {
  id        String   @id @default(uuid())
  category  String   // lda, spending, congress, regulatory, anomaly
  title     String
  body      String   @db.Text
  severity  String   @default("info") // info, notable, critical
  dataPoints Json?   @map("data_points")
  generatedAt DateTime @default(now()) @map("generated_at")
  expiresAt   DateTime? @map("expires_at")

  @@index([category, generatedAt])
  @@map("intelligence_insight")
}
```

Also add relations to existing CongressBill model:
```prisma
model CongressBill {
  // ... existing fields ...
  actions    CongressBillAction[]
  committees CongressBillCommittee[]
  subjects   CongressBillSubject[]
}
```

Generate migration: `npx prisma migrate dev --create-only --name intel_optimization`
INSPECT the SQL — trim to only new tables + altered CongressBill.

#### B. SYNC SCRIPT: Federal Register

Create apps/api/scripts/sync-federal-register.ts:
- API: https://www.federalregister.gov/api/v1/documents.json
- No auth needed
- Params: `conditions[publication_date][gte]=2021-01-01&per_page=100&page=N&order=newest`
- Fields to extract: document_number, type, title, abstract, agencies[].name, publication_date, comments_close_on, effective_on, docket_ids, cfr_references, html_url, pdf_url, topics, significant
- Paginate through all pages
- Upsert by document_number
- Estimated: ~250K documents over 5 years, ~4-6 hours

#### C. SYNC SCRIPT: Expanded Congress data

Modify apps/api/scripts/sync-congress.ts to also fetch per-bill:
- `/bill/{congress}/{type}/{number}/actions` → congress_bill_action
- `/bill/{congress}/{type}/{number}/committees` → congress_bill_committee  
- `/bill/{congress}/{type}/{number}/subjects` → congress_bill_subject
- Only fetch for 118th + 119th Congress bills
- Add 200ms delay between detail requests (rate limit)
- This adds 3 API calls per bill × ~10K bills = ~30K calls

#### D. API: New endpoints

Add to lda-intel.controller.ts:
- GET /api/lda-intel/lobbyists/:id/positions — returns lobbyist covered positions (revolving door)
- GET /api/lda-intel/clients/:id/network — returns {lobbyists, firms, issues, relatedClients, governmentTargets} for a client

Create apps/api/src/federal-register/federal-register.module.ts, .controller.ts, .service.ts:
- GET /api/federal-register/documents — paginated, filter by type/agency/topic/dateRange
- GET /api/federal-register/documents/:documentNumber — single document detail
- GET /api/federal-register/upcoming-deadlines — comment periods closing in next 30 days
- GET /api/federal-register/by-agency/:agencyName — documents by agency

Add to lda-intel.controller.ts:
- GET /api/lda-intel/insights — auto-generated AI insights (from intelligence_insight table)
- POST /api/lda-intel/insights/generate — trigger AI insight generation

Modify congress bills endpoint to include actions, committees, subjects:
- GET /api/lda-intel/congress/bills/:id — full bill detail with actions/committees/subjects

#### E. API: AI Insight Generation Service

Create a method in engagement-ai.service.ts (or a new intelligence-ai.service.ts):
- `generateIntelligenceInsights()` — queries recent data changes and generates 3-5 insights per category:
  - LDA: spending surges, new entrants, issue area shifts
  - Congress: bill movement, committee activity, new legislation
  - Spending: contract award changes, agency budget shifts
  - Regulatory: upcoming comment deadlines, new rules (once Fed Register is synced)
- Uses the same OpenAI/Anthropic provider fallback pattern
- Stores results in intelligence_insight table
- Called on-demand via endpoint or on a schedule

#### F. FRONTEND: Intelligence Center upgrades

Modify IntelligenceCenterPage.tsx — ADD to existing tabs, don't rewrite:

1. **AI Insights Banner** (top of page, above tabs):
   - Horizontal card strip showing 3-5 latest insights
   - Each insight: colored left border (blue=info, orange=notable, red=critical), title, 2-line body, timestamp
   - "Refresh Insights" button
   - Fetch from GET /api/lda-intel/insights

2. **Client Context Toggle** (top right, next to tabs):
   - Select dropdown: "All Data" | [list of clients]
   - When a client is selected, all tabs filter to show data relevant to that client
   - LDA: filter to filings mentioning that client
   - Spending: filter to that client's contractor record
   - Congress: filter to bills matching client's issue codes

3. **Revolving Door column on Lobbyists tab**:
   - Add "Former Positions" column to the lobbyists table
   - Show covered_positions data — format: "Fmr. LA, Sen. Smith (2018-2020)"
   - Highlight with a gold badge when a lobbyist has government experience

4. **Time Comparison cards on LDA Overview**:
   - Add a row of QoQ comparison cards below the hero stats:
     - "Filings this quarter vs last: +12% (↑)"
     - "New clients this quarter: 342"  
     - "Top surging issue: DEF (+34%)"
   - Calculate from lda_filing data grouped by year+period

5. **New "Regulations" tab** (10th tab):
   - Table: Federal Register documents
   - Columns: Date, Type (tag: RULE/PROPOSED/NOTICE), Title, Agencies, Comment Deadline
   - Highlight rows where comment deadline is within 14 days (yellow) or 7 days (red)
   - "Upcoming Deadlines" card at top showing next 10 closing comment periods
   - Filter by agency, type, date range

6. **Congress tab enhancements**:
   - Add expandable row detail showing: actions timeline, committee referrals, subjects
   - Click bill → expand to see full history
   - "Active Bills" filter (bills with action in last 30 days)

7. **Cross-entity click-through**:
   - On LDA Overview: clicking a client name navigates to Filings tab filtered to that client
   - On Firms tab: clicking a firm shows their clients and lobbyists
   - On Lobbyists tab: clicking a lobbyist shows their firms and clients
   - Use tab switching + filter state (no new pages needed — just set filter and switch tab)

### IMPORTANT CONSTRAINTS
- All Prisma queries MUST use the GLOBAL tables pattern for intel data (no withTenant — these are GLOBAL tables without RLS)
- Use `Record<string, unknown>` for dynamic Prisma where clauses
- Federal Register API has no auth — just fetch directly
- GovInfo API key: pass as query param `api_key`
- Keep all existing functionality — ADD to the Intelligence Center, don't break it
- Use Ant Design components matching existing patterns
- The IntelligenceCenterPage.tsx is 1,557 lines. Add new panels/components but keep the existing ones working.
