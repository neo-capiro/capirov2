# Clio Data-Coverage Remediation Plan

**Status:** proposed · **Author:** audit 2026-06-05 · **Owner:** Ninja

Clio (the chat agent in `apps/api/src/clio/`) is blind to several large, populated
datasets and is wired to a few empty ones. This plan fixes all of it: expose the
missing data, fix the system prompt, get the most out of LDA, and close the
ingestion gaps. Every number below was verified against **prod Aurora**
(`capiro-dev-data`, account 967807252336) on 2026-06-05 via the sanctioned
read-only verbs `diag-ingestion-health` + `report-award-pe-coverage` and a one-off
pure-node table census (temp task-def revision, since deregistered).

---

## 1. Verified prod data (2026-06-05)

### Exposed to Clio AND populated ✅
| Source | Rows | Clio tool |
|---|---:|---|
| LDA filings | 513,347 (fresh 06-02) | `search_lda_filings` |
| Congress bills | 15,000 (+58k actions) | `search_congress_bills` |
| SEC filings | 10,978 | `search_sec_filings` |
| CRS reports | 23,223 | `search_crs_reports` |
| Committee hearings | 2,872 | `search_committee_hearings` |
| Federal awards | 10,052 | `search_federal_awards` |
| FEC contributions | 9,000 | (via `query_intelligence`) |
| Census districts | 440 | `query_economic_data` (census) |
| Federal Register docs | 6,006 | (not directly) |

### Exposed to Clio but EMPTY or THIN ⚠️ (tool exists, returns little/nothing)
| Source | Rows | Issue |
|---|---:|---|
| **Federal grants** | **0** | `search_federal_grants` returns nothing |
| **State bills** | **0** | `search_state_bills` returns nothing |
| **BEA economic** | **0** | `query_economic_data` (bea) returns nothing |
| FARA registrations | 561 | thin (real FARA universe is ~10–100×) |
| GAO reports | 42 | thin |
| Intel articles (news) | 560 | thin |
| BLS | 18 series / 1,085 pts | thin |
| Federal contractors | 41 | thin |

### Populated but NOT exposed to Clio ❌ (the opportunity)
| Source | Rows | Notes |
|---|---:|---|
| **Program elements** | **1,154** | + 4,022 PE-years, 1,645 projects, 3,616 source citations, 22,199 reconciliation values. FY2024–2027 request/enacted budget data. |
| **Acquisition personnel** | **7,745** | + 16,359 source citations. Who drives PE/program decisions. |
| **LDA clients** | 45,648 | Clio only searches *filings*, not these. |
| **LDA lobbyists** | 24,689 | incl. `coveredPositions` = revolving-door signal |
| **LDA contributions (LD-203)** | 192,553 | PAC / political giving — "follow the money" |
| **LDA registrants** | 6,955 | lobbying firms |
| **Regulatory dockets** | 9,988 | + 6,006 Federal Register docs |
| **FEC committees** | 5,269 | PAC/committee finance |
| LDA issue codes / gov entities | 79 / 257 | trend + targeting context |

### PE sub-tables that are EMPTY (features will look broken even once exposed)
- `program_element_milestone`: **0**
- `program_element_procurement_line`: **0**
- `conference_probability`: **0** (the `recompute-conference-probability` job has produced nothing)

### `federal_award` PE linkage (from `report-award-pe-coverage`)
- 10,052 awards · **227 (2.3%) carry a resolved `peCode`** · curated acq-program→PE map has only **31 entries** → PE→contractor panel works for **29 of 1,154 PEs**. See `.hermes/plans/pe-contractor-linkage.md`.

> **Caveat:** tenant-scoped tables (`clients`, `meetings`, `mail_threads`) read `0` under the system DB role because of RLS — not necessarily empty. The audit's focus (global intel tables) is unaffected.

---

## 2. Root causes (three distinct problems)

1. **Missing tools.** PE subsystem, acquisition personnel, LDA depth, regulatory, and FEC are fully built (services + controllers + populated tables) but have **no Clio tool**. `ProgramElementReadService` and `AcquisitionPersonnelReadService` are ready to wrap.
2. **Discoverability.** The system-prompt capability sentence ([clio.service.ts:1237](apps/api/src/clio/clio.service.ts:1237)) lists "SEC/FARA filings, federal grants, GAO/CRS reports…" but **omits federal contract awards / PE codes** — so the model under-calls `search_federal_awards`.
3. **Ingestion gaps.** `federal_grant`, `state_bill`, `bea_data` are **empty**; FARA/GAO/intel_article/BLS/contractors are **thin**. Likely linked to a runtime bug (next item).

### Cross-cutting bug found during the audit: broken `tsx` temp dir
One-off `tsx`-based tasks crash at startup: `mkdir '/app/tmp/tsx-1001' ENOENT` (and `/tmp` is also absent). `TMPDIR=/dev/shm` works around it. **Every `tsx`-dispatched job in `entrypoint.sh`** (all `sync-*`, `diag-*`, `parse-*`) is affected when run without a writable `TMPDIR`. The three empty sources above (`grants`, `state`, `bea`) are exactly such syncs → **strong suspicion their EventBridge runs are silently failing.** (LDA/congress are fresh, so it isn't universal — verify per-job.) Fix at the image level.

---

## 3. The plan

### Phase 0 — Quick wins (low risk, high leverage)
- **0.1** Fix the capability sentence in [clio.service.ts:1237](apps/api/src/clio/clio.service.ts:1237) to name federal contract awards (+ the new PE/personnel sources once added).
- **0.2** Fix the `TMPDIR`/`tsx` bug: set `TMPDIR=/dev/shm` (or `mkdir -p /app/tmp` / mount ephemeral storage) in `apps/api/scripts/entrypoint.sh` or the Dockerfile. Then **audit EventBridge sync schedules** and confirm `sync-grants`, `sync-openstates`, `sync-bea` actually succeed.
- **0.3** Repair + extend `diag-ingestion-health.ts`: wrong physical table names (`regulation` → `regulatory_docket`, `rss_intel_item` → `intel_article`) and add PE / personnel / LDA-sub / grants / state / bea / fec_committee so "is it all there" is answerable in one shot.

### Phase 1 — Program Element tools (highest value: 1,154 PEs, FY24–27 budgets)
Wrap the existing `ProgramElementReadService` (no new data work). New tools in
[clio-tools.service.ts](apps/api/src/clio/clio-tools.service.ts):
- `search_program_elements` → `listProgramElements` (search by title/peCode, filter service & budget activity)
- `get_program_element` → `getProgramElement` (detail + years)
- `get_pe_budget_timeline` → `getTimeline` (FY request/HASC/SASC/HAC-D/SAC-D/conference/enacted + milestones + conference probability)
- `get_pe_contractors` → `getContractors` (⚠️ sparse — only 29 PEs return rows today; message honestly)
- `get_pe_bills` → `getBills` (bills via `congress_bill.peCodes`)

Wiring: add to `TOOL_DEFINITIONS`, `anthropicToolSchemas`, the `execute` switch; inject `ProgramElementReadService` (+ ensure `ProgramElementModule` exports it / is imported by `ClioModule`). Gate messaging for empty `milestone`/`conference_probability`.

### Phase 2 — Acquisition Personnel tool (7,745 people)
Wrap `AcquisitionPersonnelReadService`:
- `search_acquisition_personnel` (by name/org/service/role)
- `get_acquisition_person` (detail + sources + PE linkage)
Pairs with Phase 1 ("who runs PE 0207138F?").

### Phase 3 — Get the most out of LDA (513k filings · 45k clients · 24k lobbyists · 192k LD-203)
Clio uses **1 of ~22** `LdaIntelService` methods. Add the high-value set:
- `lookup_lda_client` → `matchCapiroClient` (fuzzy "is my client lobbying / who lobbies for them")
- `search_lda_lobbyists` → `getLobbyists` / `getLobbyistPositions` (**revolving-door**: covered gov positions)
- `analyze_lda_contributions` → `getContributions` (LD-203 PAC money)
- `map_client_network` → `getClientNetwork` (firms ↔ lobbyists ↔ issues ↔ gov targets ↔ competing clients)
- `get_lda_issue_trends` → `getIssueDetail` / `getTrends` (surging issues + top clients)
- `search_lda_registrants` → `getRegistrants` / `getRegistrantById` (firm → clients)

(Defer lower-value `getDashboard`, `getEntities`, `getIssues` unless needed — keep the tool list lean.)

### Phase 4 — Regulatory + FEC + ingestion fixes
- `search_regulatory_dockets` / `search_federal_register` (9,988 + 6,006 rows — comment windows, proposed rules).
- `search_fec_committees` → `getFecCommittees` (5,269).
- **Ingestion:** populate the empties (`grants`, `state bills`, `bea`) and deepen the thin ones (`fara` 561, `gao` 42, `intel_article` 560, `federal_contractor` 41). Depends on Phase 0.2.

### Phase 5 — Tighten & ship
- Extend `query_intelligence` source-count list (clio-tools.service.ts:596) to include PE, personnel, regulatory, FEC committees.
- Update intent guidance + skill `requiredTools` ([lobbying-skills.ts](apps/api/src/clio/skills/lobbying-skills.ts)); consider new PE/defense-acquisition skills.
- Tests: extend `clio-tools.service.spec.ts`; add coverage cases to `eval-clio`.
- Re-verify prod with the fixed `diag-ingestion-health`.

---

## 4. Files to touch
- `apps/api/src/clio/clio-tools.service.ts` — `TOOL_DEFINITIONS`, `anthropicToolSchemas`, `execute`, new private methods, constructor injection (PE / personnel / richer LDA services)
- `apps/api/src/clio/clio.module.ts` — import the modules whose services Clio now needs
- `apps/api/src/clio/clio.service.ts` — capability sentence (:1237), intent guidance, source counts
- `apps/api/src/clio/skills/lobbying-skills.ts` — skill `requiredTools` / new skills
- `apps/api/scripts/entrypoint.sh` (or Dockerfile) — `TMPDIR` fix
- `apps/api/scripts/diag-ingestion-health.ts` — name fixes + add tables
- `infra/cdk` (EventBridge sync rules) — verify grants/state/bea schedules

## 5. Risks & sequencing
- **Tool-count growth** (24 → ~38). Mitigate with crisp descriptions and skill-scoped `requiredTools`; the prompt-cache breakpoint already sits on the last tool, so caching is unaffected.
- **PE→contractor sparsity** is a *data* problem (`pe-contractor-linkage.md`), independent of exposing the tool — set expectations in the tool description.
- Ship order: **0 → 1 → 3 → 2 → 4 → 5** (prompt + PE first = biggest perceived win; LDA depth second since data is richest; ingestion fixes can run in parallel once 0.2 lands).
