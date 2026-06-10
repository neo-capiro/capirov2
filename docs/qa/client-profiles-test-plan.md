# QA Test Plan — Client Profiles

**Feature:** Client Profiles (Client Workspace → Client Profile detail)
**Target environment:** Production — `https://app.capiro.ai` (AWS account starting with `9`)
**Test scope (authorized):** Read-only on existing real clients; safe writes only (create a clearly-marked QA test record, clean up afterward). **No edit/archive/delete of existing real clients.**
**Tester:** Claude (senior QA agent) via Chrome MCP
**Date:** 2026-06-09
**Auth:** Clerk (logged-in session in the connected browser)

---

## 1. Test Objective

Verify that the Client Profile feature works end-to-end across all tabs, both in the UI and at the backend API layer. Confirm functional correctness, data integrity, validation, error handling, UI/UX, basic accessibility, and performance. Identify bugs, edge cases, unclear behavior, and risks.

A "client profile" is the detail view opened from `/clients` (Client Workspace). It is composed of the following tabs (per `apps/web/src/pages/clients/ClientProfilePage.tsx`):

| # | Tab | Primary data source |
|---|-----|---------------------|
| 1 | Overview | `GET /api/clients/:id` + child aggregates |
| 2 | Capabilities | `GET /api/clients/:clientId/capabilities` |
| 3 | People | `GET /api/clients/:clientId/people` |
| 4 | Facilities | `GET /api/clients/:clientId/facilities` |
| 5 | Workflows | workflow instances |
| 6 | Documents | `GET /api/engagement/attachments?clientId=` + notes |
| 7 | Intelligence | `GET /api/intelligence/clients/:clientId/profile-v1` (+ sub-endpoints) |
| 8 | DoW Directory | DoW directory data |

---

## 2. Preconditions / Test Data

- Logged-in user with at least `standard_user` role on a tenant that has ≥1 real client with populated data (LDA, PE, personnel).
- A real client with rich Intelligence data (for read-only intel checks).
- A QA test client will be created (name prefixed `ZZ-QA-TEST-`) for write-flow tests, then cleaned up.

---

## 3. Test Cases

### TC-A: Client Workspace (list) — load & navigation
- **A1** List loads without error; clients render with name/sector/status.
- **A2** Filters (profileStatus, sectorTag) apply and AND together.
- **A3** Selecting a client opens the profile detail; correct client shown.
- **A4** Reload after selecting a client — does selection persist? (Known risk: state-based, not deep-linkable.)
- **A5** Empty/loading/error states render sensibly.

### TC-B: Overview tab (read)
- **B1** Renders client basics (name, website, description, contacts).
- **B2** Top capabilities / top people / intake summary render and match child tabs.
- **B3** Logo renders if present; graceful fallback if absent.
- **B4** Health/completeness indicators (if shown) are plausible.

### TC-C: Capabilities tab
- **C1** (read) List renders all capabilities with name/type/sector/TRL/MRL/funding.
- **C2** (read) Submission history renders per capability.
- **C3** (safe write, QA client) Create capability with name only → succeeds.
- **C4** (safe write, QA client) TRL=0 and TRL=10 → expect rejection (valid 1–9). MRL=0/11 → reject (valid 1–10).
- **C5** (safe write, QA client) fundingAsk negative / non-numeric → validation behavior.
- **C6** (safe write, QA client) Edit capability via PATCH omitting name → should still succeed (name optional on PATCH).

### TC-D: People tab
- **D1** (read) List renders name/title/email/phone/role/lastContact.
- **D2** (safe write, QA client) Add person with name only → succeeds.
- **D3** (safe write, QA client) Invalid email → validation behavior.
- **D4** (safe write, QA client) Duplicate email within same client → currently allowed? (Risk: no unique constraint.)

### TC-E: Facilities tab
- **E1** (read) List renders address/state/district/employeeCount.
- **E2** (safe write, QA client) state=CA, congressionalDistrict=99 (invalid for CA) → currently accepted? (**High-risk: no state↔district validation.**)
- **E3** (safe write, QA client) district="00" (at-large) → accepted.
- **E4** (safe write, QA client) district="3A" or "abc" → rejected by regex `^[0-9]{1,2}$`.
- **E5** (safe write, QA client) state="California" (full name vs 2-char) / employeeCount negative → validation.

### TC-F: Documents tab
- **F1** (read) Attachments list renders for a real client.
- **F2** (read) Notes / quick-log renders.
- **F3** (safe write, QA client) Append a note → persists and shows.
- **F4** Logo/doc upload: oversized (>2 MB) and wrong type (e.g. .exe) → rejected. (Use QA client only; skip if file upload not feasible in MCP.)

### TC-G: Intelligence tab (read-only — highest blast radius)
- **G1** `profile-v1` loads; all sections render (Snapshot, Financial Footprint, Legislative/Regulatory, Relationships).
- **G2** Section nav / scroll-spy works.
- **G3** Sub-endpoints succeed (lobbying-roi, fec-money-flow, competitor-board, ex-staffers, bills, tracked-bills, health-score, district-nexus, report-card, knowledge-graph, issue-code-signal).
- **G4** Thin-signal client (few LDA matches) → graceful, not garbage (known GIGO risk).
- **G5** profile-v1 latency (known ~12s slow aggregate) — measure.
- **G6** If any sub-endpoint errors, is the failure isolated or does it blank the whole tab? (Known: swallowed errors blank sections silently.)
- **G7** Numeric/units sanity (PE funding in millions; no "$477000.00m" regressions; no "no funding" false marks).

### TC-H: Workflows tab (read)
- **H1** Workflow instances render; tied to capabilities.

### TC-I: DoW Directory tab (read)
- **I1** Renders DoW directory data; check for stale spreadsheet PEs / stale personnel (known: old `stanford_*` data still displays).

### TC-J: Cross-cutting / backend
- **J1** Network: capture all `/api/*` requests per tab; record status codes + latency.
- **J2** Console: capture JS errors/warnings during navigation.
- **J3** 404 client id (`GET /api/clients/<bogus-uuid>`) → 404, not 500.
- **J4** Auth: requests carry Clerk JWT; no anonymous data leakage.
- **J5** Tenant isolation (light): a client id from another tenant → 403/404 (cannot fully test without 2nd tenant; note as limitation).
- **J6** Deep-link: hitting a profile URL directly / reload — behavior.

### TC-K: Safe-write QA client lifecycle
- **K1** Create client `ZZ-QA-TEST-<timestamp>` (name only) → succeeds.
- **K2** Name >200 chars → 400.
- **K3** Invalid email / invalid website → validation behavior.
- **K4** Run C/D/E/F write cases against this client only.
- **K5** Cleanup: archive/delete the QA client at the end; confirm it leaves the list.

---

## 4. What will NOT be tested (and why)

- **Edit/archive/delete of existing real clients** — out of authorized scope (read-only + safe writes).
- **Cross-tenant data leakage (full)** — requires a second tenant/login; will note as a limitation.
- **Concurrency races** (concurrent logo uploads, resolution races) — hard to trigger reliably via single-browser MCP; noted as risks.
- **Bulk import 500/501 row limits** — would write many records to prod; out of safe-write scope.

---

## 5. Result format

Each executed area reported in the QA Result format:
Status / Summary / Findings (Bug N: title, Severity, Priority, Reproducibility, Preconditions, Actual Result, Notes/Assumptions, Recommended Additional Tests).
