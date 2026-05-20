Read the plan at .hermes/lda-intel-plan.md thoroughly. Then implement Phase 1 (Backend).

API KEYS (use these in sync scripts via process.env):
- LDA_API_KEY=b114aa166dd465fea5789480156f5efeada7d2d3  (Senate LDA: header `x-api-key`)
- FEC_API_KEY=aLzThT7IPWNSgilqipIttLkmscgMJeRgDaJhJ2zN  (FEC: query param `api_key`)
- CONGRESS_API_KEY=sGteTfXJsjlp4LutiqH5GG4t3OjGBbdbbKIhp4OQ  (Congress.gov: query param `api_key`)

## What to build

### 1. Prisma Migration SQL
Create: `apps/api/prisma/migrations/20260520010000_lda_intel_pipeline/migration.sql`

Create these GLOBAL tables (NO tenant_id, NO RLS):

**lda_filing** — 512K records from Senate LDA filings API (last 5 years)
- id UUID PK, filing_uuid TEXT UNIQUE, filing_type TEXT, filing_year INT, filing_period TEXT
- income DECIMAL(18,2) NULL, expenses DECIMAL(18,2) NULL, dt_posted TIMESTAMPTZ
- registrant_id INT, registrant_name TEXT, client_id INT, client_name TEXT
- client_state TEXT NULL, client_country TEXT NULL, client_description TEXT NULL
- issue_codes TEXT[] DEFAULT '{}', government_entities JSONB DEFAULT '[]'
- lobbyists JSONB DEFAULT '[]', lobbying_activities JSONB DEFAULT '[]'
- filing_document_url TEXT NULL, last_synced_at TIMESTAMPTZ DEFAULT now()
- Indexes: filing_uuid UNIQUE, filing_year, client_name, registrant_name, issue_codes GIN, dt_posted, client_name trigram

**lda_client** — 134K lobbying clients
- id INT PK, name TEXT, general_description TEXT NULL, state TEXT NULL, country TEXT NULL DEFAULT 'US'
- effective_date DATE NULL, total_filings INT DEFAULT 0, total_spending DECIMAL(18,2) NULL
- latest_filing_year INT NULL, issue_codes TEXT[] DEFAULT '{}', last_synced_at TIMESTAMPTZ
- Indexes: name, name trigram, state

**lda_registrant** — 17K lobbying firms
- id INT PK, house_registrant_id INT NULL, name TEXT, description TEXT NULL
- address TEXT NULL, city TEXT NULL, state TEXT NULL, country TEXT NULL
- contact_name TEXT NULL, contact_phone TEXT NULL
- total_filings INT DEFAULT 0, total_clients INT DEFAULT 0, last_synced_at TIMESTAMPTZ

**lda_lobbyist** — 88K lobbyists
- id INT PK, first_name TEXT, last_name TEXT, prefix TEXT NULL, suffix TEXT NULL
- covered_positions JSONB DEFAULT '[]', registrant_ids INT[] DEFAULT '{}'
- active_years INT[] DEFAULT '{}', last_synced_at TIMESTAMPTZ
- Indexes: (last_name, first_name), last_name trigram

**lda_contribution** — 192K contribution reports
- id UUID PK, filing_uuid TEXT UNIQUE, filing_type TEXT, filing_year INT, filing_period TEXT
- filer_type TEXT, dt_posted TIMESTAMPTZ
- registrant_id INT NULL, registrant_name TEXT NULL, lobbyist_id INT NULL, lobbyist_name TEXT NULL
- no_contributions BOOLEAN DEFAULT false, pacs JSONB DEFAULT '[]'
- contribution_items JSONB DEFAULT '[]', last_synced_at TIMESTAMPTZ

**lda_issue_code** — 79 LDA issue categories (reference)
- code TEXT PK, name TEXT, total_filings_5y INT DEFAULT 0
- total_spending_5y DECIMAL(18,2) NULL, quarterly_trend JSONB DEFAULT '[]', last_synced_at TIMESTAMPTZ

**lda_government_entity** — 257 government entities (reference)
- id INT PK, name TEXT, total_filings_5y INT DEFAULT 0, last_synced_at TIMESTAMPTZ

**fec_committee** — PACs and campaign committees from FEC API
- id TEXT PK (committee_id like C00835926), name TEXT, committee_type TEXT NULL
- designation TEXT NULL, party TEXT NULL, state TEXT NULL
- treasurer_name TEXT NULL, total_receipts DECIMAL(18,2) NULL
- total_disbursements DECIMAL(18,2) NULL, cash_on_hand DECIMAL(18,2) NULL
- cycles INT[] DEFAULT '{}', last_synced_at TIMESTAMPTZ

**fec_contribution** — Individual/PAC contributions to candidates
- id UUID PK, committee_id TEXT, committee_name TEXT NULL
- candidate_id TEXT NULL, candidate_name TEXT NULL
- contributor_name TEXT NULL, contributor_employer TEXT NULL
- contributor_occupation TEXT NULL, amount DECIMAL(18,2)
- contribution_date DATE NULL, receipt_type TEXT NULL
- memo_text TEXT NULL, state TEXT NULL, cycle INT
- last_synced_at TIMESTAMPTZ
- Indexes: committee_id, candidate_name, contributor_employer, cycle

**congress_bill** — Bills from Congress.gov API
- id TEXT PK (e.g. "119-hr-1234"), congress INT, bill_type TEXT, bill_number TEXT
- title TEXT, introduced_date DATE NULL, sponsor_name TEXT NULL
- sponsor_state TEXT NULL, sponsor_party TEXT NULL
- latest_action_text TEXT NULL, latest_action_date DATE NULL
- policy_area TEXT NULL, subjects TEXT[] DEFAULT '{}'
- committees JSONB DEFAULT '[]', cosponsors_count INT DEFAULT 0
- origin_chamber TEXT NULL, update_date TIMESTAMPTZ NULL
- url TEXT NULL, last_synced_at TIMESTAMPTZ
- Indexes: congress, policy_area, subjects GIN, title trigram

Use CREATE TABLE only. Do NOT touch existing tables. Do NOT add/drop FKs.

### 2. Prisma Schema
Add corresponding Prisma models to end of `apps/api/prisma/schema.prisma`. Keep all existing models.

### 3. Sync Scripts

**apps/api/scripts/sync-lda.ts** — Senate LDA pipeline
- Fetch from `https://lda.senate.gov/api/v1/` with header `x-api-key: ${process.env.LDA_API_KEY}`
- Pull last 5 years (2021-2026)
- Step 1: Fetch issue codes + government entities (reference)
- Step 2: Paginate filings by year (page_size=100, use filing_year param)
- Step 3: Extract + upsert clients, registrants, lobbyists from filings
- Step 4: Paginate contributions by year
- Step 5: Compute aggregates (total_filings, total_spending per client)
- Support --incremental flag (only fetch since last sync)
- Handle nulls defensively, skip bad records with logging
- Log progress per 1000 records

**apps/api/scripts/sync-fec.ts** — FEC pipeline
- Fetch from `https://api.open.fec.gov/v1/` with query param `api_key=${process.env.FEC_API_KEY}`
- Step 1: Fetch top committees (search for major lobbying-related PACs)
- Step 2: For each committee, fetch recent contributions (schedule_a)
- Focus on: tech, defense, energy, healthcare PACs
- Page with `page=N&per_page=100`

**apps/api/scripts/sync-congress.ts** — Congress.gov pipeline
- Fetch from `https://api.congress.gov/v3/` with query param `api_key=${process.env.CONGRESS_API_KEY}`
- Fetch recent bills (last 2 congresses: 118th, 119th)
- For each bill, get subjects and committees
- Focus on bills with lobbying-relevant policy areas
- Page with `offset=N&limit=100`

Also FIX existing sync-openlobby.ts and sync-openspending.ts:
- Add try/catch per record with skip-on-error logging
- Filter nulls from arrays before Prisma upsert
- Add proper error handling for fetch failures

### 4. NestJS Module: `apps/api/src/lda-intel/`
Create lda-intel.module.ts, lda-intel.service.ts, lda-intel.controller.ts

Service methods:
- getDashboard() — aggregate stats (total filings, spending, clients, lobbyists, issues)
- getFilings(filters) — paginated, filterable by year, issue_code, client, registrant
- getClients(search, issueCode, state, page, limit) — paginated search
- getClientDetail(id) — client with filing summary, top issues, firms, spending timeline
- getRegistrants(search, page, limit) — lobbying firms
- getRegistrantDetail(id) — firm with clients, filings
- getLobbyists(search, page, limit) — lobbyist search
- getIssues() — all 79 issue codes ranked by spending
- getIssueDetail(code) — issue with top clients, trend
- getEntities() — gov entities ranked by filings
- getContributions(filters) — contribution search
- getTrends() — quarterly spending trends
- matchCapiroClient(clientName) — trigram match to LDA clients
- getCongressBills(search, policyArea, congress, page, limit)
- getFecCommittees(search)

Controller REST endpoints:
```
GET /lda-intel/dashboard
GET /lda-intel/filings
GET /lda-intel/clients
GET /lda-intel/clients/:id
GET /lda-intel/registrants
GET /lda-intel/registrants/:id
GET /lda-intel/lobbyists
GET /lda-intel/issues
GET /lda-intel/issues/:code
GET /lda-intel/entities
GET /lda-intel/contributions
GET /lda-intel/trends
GET /lda-intel/match/:clientName
GET /lda-intel/congress/bills
GET /lda-intel/fec/committees
```

READ existing controllers first (lobby-intel.controller.ts, federal-spending.controller.ts) to match auth/decorator patterns.

### 5. Register module in app.module.ts

### 6. Add package.json scripts
```json
"sync:lda": "tsx scripts/sync-lda.ts",
"sync:lda:incremental": "tsx scripts/sync-lda.ts --incremental",
"sync:fec": "tsx scripts/sync-fec.ts",
"sync:congress": "tsx scripts/sync-congress.ts"
```

Do NOT modify files not mentioned. Do NOT delete existing code. READ existing files first to match patterns.
