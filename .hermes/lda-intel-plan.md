# LDA Federal Intelligence Pipeline — Full Build Plan

## Feature Summary
Replace the current limited OpenLobby/OpenSpending data (5K curated clients, 39 contractors) with the full Senate LDA dataset (last 5 years: 512K filings, 134K clients, 88K lobbyists). Build a professional, visually rich Intelligence Center and Client Federal Intel tab that makes this data actionable for government affairs lobbyists. Fix the existing sync scripts.

## Data Sources
- **Senate LDA API**: `https://lda.senate.gov/api/v1/` — NO API KEY needed
  - `/filings/` — 512K records (2021-2026), filterable by `filing_year`, `filing_dt_posted_after`
  - `/clients/` — 134K lobbying clients
  - `/registrants/` — 17K lobbying firms
  - `/lobbyists/` — 88K registered lobbyists
  - `/contributions/` — 192K contribution reports (2021-2026)
  - `/constants/filing/lobbyingactivityissues/` — 79 LDA issue codes
  - `/constants/filing/governmententities/` — 257 government entities
- **OpenLobby** (existing, fix sync): `https://www.openlobby.us/data/*.json`
- **OpenSpending** (existing, fix sync): `https://www.openspending.us/data/*.json`

## Data Model — New Prisma Tables

All GLOBAL tables (no tenant_id, no RLS). Keep existing tables, ADD new ones:

### lda_filing (core — 512K records, ~900MB in PG)
```
id                UUID PK
filing_uuid       TEXT UNIQUE  -- from LDA API
filing_type       TEXT         -- Q1, Q2, Q3, Q4, RR, etc.
filing_year       INT
filing_period     TEXT         -- first_quarter, second_quarter, etc.
income            DECIMAL(18,2) NULL  -- $ reported by registrant
expenses          DECIMAL(18,2) NULL
dt_posted         TIMESTAMPTZ
registrant_id     INT          -- FK concept (LDA registrant id)
registrant_name   TEXT
client_id         INT          -- FK concept (LDA client id)
client_name       TEXT
client_state      TEXT NULL
client_country    TEXT NULL DEFAULT 'US'
client_description TEXT NULL
issue_codes       TEXT[]       -- e.g. ['HCR','DEF','TAX']
government_entities JSONB DEFAULT '[]'  -- [{id, name}]
lobbyists         JSONB DEFAULT '[]'    -- [{first_name, last_name, covered_position}]
lobbying_activities JSONB DEFAULT '[]'  -- full activities array
filing_document_url TEXT NULL
last_synced_at    TIMESTAMPTZ DEFAULT now()
```
Indexes: filing_uuid (unique), filing_year, client_name, registrant_name, issue_codes (GIN), dt_posted, client_name trigram

### lda_client (134K records, ~72MB)
```
id                INT PK       -- LDA API id
name              TEXT
general_description TEXT NULL
state             TEXT NULL
country           TEXT NULL DEFAULT 'US'
effective_date    DATE NULL
total_filings     INT DEFAULT 0     -- computed
total_spending    DECIMAL(18,2) NULL -- computed from filings
latest_filing_year INT NULL
issue_codes       TEXT[] DEFAULT '{}' -- aggregated from filings
last_synced_at    TIMESTAMPTZ DEFAULT now()
```
Indexes: name, name trigram, state

### lda_registrant (17K records, ~4MB)
```
id                INT PK       -- LDA API id
house_registrant_id INT NULL
name              TEXT
description       TEXT NULL
address           TEXT NULL
city              TEXT NULL
state             TEXT NULL
country           TEXT NULL DEFAULT 'US'
contact_name      TEXT NULL
contact_phone     TEXT NULL
total_filings     INT DEFAULT 0
total_clients     INT DEFAULT 0
last_synced_at    TIMESTAMPTZ DEFAULT now()
```

### lda_lobbyist (88K records, ~35MB)
```
id                INT PK       -- LDA API id
first_name        TEXT
last_name         TEXT
prefix            TEXT NULL
suffix            TEXT NULL
covered_positions JSONB DEFAULT '[]'  -- aggregated from filings
registrant_ids    INT[] DEFAULT '{}'
active_years      INT[] DEFAULT '{}'
last_synced_at    TIMESTAMPTZ DEFAULT now()
```
Indexes: (last_name, first_name), name trigram

### lda_contribution (192K records, ~160MB)
```
id                UUID PK
filing_uuid       TEXT UNIQUE
filing_type       TEXT
filing_year       INT
filing_period     TEXT
filer_type        TEXT  -- lobbyist | registrant
dt_posted         TIMESTAMPTZ
registrant_id     INT NULL
registrant_name   TEXT NULL
lobbyist_id       INT NULL
lobbyist_name     TEXT NULL
no_contributions  BOOLEAN DEFAULT false
pacs              JSONB DEFAULT '[]'
contribution_items JSONB DEFAULT '[]'  -- [{amount, recipient_name, type, ...}]
last_synced_at    TIMESTAMPTZ DEFAULT now()
```

### lda_issue_code (79 records — reference table)
```
code              TEXT PK      -- e.g. HCR, DEF
name              TEXT         -- e.g. Health Issues, Defense
total_filings_5y  INT DEFAULT 0
total_spending_5y DECIMAL(18,2) NULL
quarterly_trend   JSONB DEFAULT '[]' -- [{quarter, filings, spending}]
last_synced_at    TIMESTAMPTZ DEFAULT now()
```

### lda_government_entity (257 records — reference table)
```
id                INT PK
name              TEXT
total_filings_5y  INT DEFAULT 0
last_synced_at    TIMESTAMPTZ DEFAULT now()
```

## API Endpoints (NestJS)

### Module: `lda-intel` (new, replaces/extends lobby-intel)
```
GET  /lda-intel/dashboard              -- aggregate stats for Intelligence Center
GET  /lda-intel/filings                -- paginated, filterable filings list
GET  /lda-intel/filings/:uuid          -- single filing detail
GET  /lda-intel/clients                -- paginated client search (name, state, issue)
GET  /lda-intel/clients/:id            -- client detail with filing history
GET  /lda-intel/clients/:id/filings    -- client's filings
GET  /lda-intel/registrants            -- lobbying firms list
GET  /lda-intel/registrants/:id        -- firm detail
GET  /lda-intel/lobbyists              -- lobbyist search
GET  /lda-intel/lobbyists/:id          -- lobbyist detail
GET  /lda-intel/issues                 -- issue code leaderboard with trends
GET  /lda-intel/issues/:code           -- single issue detail + top clients
GET  /lda-intel/entities               -- government entities + filing counts
GET  /lda-intel/contributions          -- contribution search
GET  /lda-intel/trends                 -- quarterly spending trends
GET  /lda-intel/match/:clientId        -- fuzzy match Capiro client to LDA clients
```

### Keep existing endpoints:
- `/lobby-intel/*` — OpenLobby curated data (keep as "featured" layer)
- `/federal-spending/*` — OpenSpending contractor data (keep)

## Sync Script: `apps/api/scripts/sync-lda.ts`

Single script that pulls all 5 years of data from Senate LDA API:
1. Fetch all issue codes + government entities (reference tables)
2. Paginate through filings year by year (2021-2026), page_size=100
3. Extract + upsert clients, registrants, lobbyists from filings
4. Paginate through contributions (2021-2026)
5. Compute aggregates (total_filings, total_spending per client/registrant)
6. Estimated runtime: 30-40 min (512K records / 100 per page = 5K API calls)
7. Incremental mode: on subsequent runs, only fetch filings posted after last sync

## Frontend: Intelligence Center Page (complete rewrite)

Professional dashboard with these sections:

### 1. Hero Stats Bar
- Total Filings (5yr) | Total Spending | Active Clients | Active Lobbyists | Issue Areas

### 2. Spending Trends Chart
- Line/area chart: quarterly lobbying spend over 5 years
- Toggleable by issue code

### 3. Top Spenders Leaderboard
- Table: rank, client name, total spend, filing count, top issues, trend sparkline
- Sortable columns, search/filter

### 4. Issue Code Heatmap/Grid
- 79 issue codes as a visual grid, sized/colored by spending volume
- Click to drill into issue detail

### 5. Top Lobbying Firms
- Table: firm name, client count, total filings, top clients

### 6. Active Lobbyists
- Searchable table with covered positions, firm, active years

### 7. Government Entity Targets
- Which agencies are being lobbied most? Bar chart + table

### 8. Recent Filings Feed
- Live feed of latest filings with client, firm, issues, amount

### 9. Federal Spending Tab (existing, enhanced)
- Top contractors, agencies, industries from OpenSpending

## Frontend: Client Profile — Federal Intel Tab (enhance)

When viewing a Capiro client profile, the Federal Intel tab should:

1. **Auto-match** the Capiro client name to LDA clients (fuzzy trigram match)
2. Show matched client's:
   - Total lobbying spend over 5 years (with sparkline)
   - All filings timeline
   - Issue codes they lobby on
   - Which firms represent them
   - Which lobbyists work for them
   - Which government entities they target
   - Competitor comparison (other clients lobbying same issues)
3. Show federal contractor data (from OpenSpending) if matched
4. Show curated OpenLobby data if matched

## Visual Design Notes
- Use Ant Design charts (Area, Column, Pie, Treemap) — already in the project
- Dark stat cards with large numbers and trend indicators
- Color coding: green=growing, red=declining, blue=neutral
- Professional color palette matching Capiro's existing design
- Responsive layout with collapsible sections
- Loading skeletons for async data

## Implementation Phases

### Phase 1: Backend (Claude Code)
- New Prisma models + migration SQL
- sync-lda.ts script
- NestJS lda-intel module (service, controller, module)
- Fix existing sync-openlobby.ts and sync-openspending.ts

### Phase 2: Frontend (Claude Code)
- Complete rewrite of IntelligenceCenterPage.tsx
- Enhance ClientProfilePage.tsx Federal Intel tab
- New chart components as needed

### Phase 3: Build, Deploy, Sync, Test (Hermes)
- Docker build + ECR push
- Migration on staging + prod
- Run sync tasks
- Smoke test
