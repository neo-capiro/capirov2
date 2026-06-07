# Intelligence Tab — Remediation TODO (accumulating)

> Working backlog from the 2026-06-05 investigation of the client-profile
> Intelligence tab. **DO NOT IMPLEMENT YET** — items are agreed but deferred;
> we'll execute them together once the full picture is mapped. Each item has
> file:line anchors so it can be picked up cold.

---

## Item 1 — Issue codes: auto-populate from LDA + remove the capability dropdown

**Decision:** Option 1 (auto-populate + manual override) AND remove the
issue-code control from the capability menu.

### Background (verified 2026-06-05)
- Real issue codes are LDA codes (`lda_issue_code`, 79 rows; matched exact +
  case-sensitive everywhere).
- They originate **per filing** at `lobbying_activities[].general_issue_code`
  (`apps/api/scripts/sync-lda.ts:61, 318`) → stored on `lda_filing.issue_codes`
  (`sync-lda.ts:341`) → aggregated DISTINCT up to `lda_client.issue_codes`
  (`sync-lda.ts:499-517`). **Attached to the LDA client, derived from the
  filing's activities — NOT to a capability.**
- The Intelligence tab (tracked bills, office recommender, issue drill-through,
  report card) reads `lda_client.issue_codes` via the confirmed LDA mapping
  (`intelligence.service.ts:2657-2661`).
- The capability dropdown writes `client_capability.issueCodes`
  (`issue_codes_jsonb`) — `CapabilityDrawer.tsx:377-389` and the capability form
  field in `ClientProfilePage.tsx:1719-1737`. This value is **NOT read by bill
  matching**: `getTrackedBills()` (`service:2680-2693`) and
  `capabilityFallbackTerms()` (`service:1596-1618`) both `select` only
  `{sector,name,tags}`. Its only consumer is capability embedding text
  (`embedder.ts:220-229`), which embeds raw opaque codes → negligible effect.
  ⇒ The dropdown is effectively inert and its tooltip is a false promise.

### To do
1. On LDA-mapping confirm, seed the client's issue codes from
   `lda_client.issue_codes` (auto). Decide override storage (NOT on capability).
2. Wire issue codes into matching: add `issueCodes` to the selects in
   `getTrackedBills()` and `capabilityFallbackTerms()`, translate code→name via
   `lda_issue_code`, fold into `allTerms` so the signal is real.
3. Remove the issue-code dropdown from the capability menu (`CapabilityDrawer`
   + `ClientProfilePage` capability form) and the `issueCodes` field from the
   capability create/patch payload (`client-capabilities.service.ts:102,145-147`)
   — or repoint it at the new client-level override. Decide migration for
   existing `client_capability.issue_codes_jsonb` values.
4. Copy fixes once behavior is real: dropdown tooltip ("improve bill/policy
   auto-matching") and office-recommender empty-state ("Confirm the client's
   issue codes or capability mappings") both over-promise.
5. Short-token / acronym matching (rides with #2). Capability tags + the keyword
   path drop tokens ≤3 chars (`t.length > 3` at service:1609/1614, 2688/2691),
   so AI / EW / C2 / ISR / UAS / UAV / PNT contribute nothing. BUT lowering the
   threshold ALONE barely helps: the embeddings path blends all terms into ONE
   vector with a 0.65 cosine floor (service:1668-1690) where raw 2–3-char tokens
   add ~no signal, and the keyword path matches WHOLE WORDS (`\m…\M`) against
   curated `congress_bill_subject.name` / `policy_area` (service:1757-1770),
   where acronyms rarely appear as standalone tokens. Real fix = an acronym→phrase
   expansion map (EW→"electronic warfare", C2→"command and control",
   ISR→"intelligence surveillance reconnaissance", UAS→"unmanned aircraft
   systems", PNT→"positioning navigation timing", AI→"artificial intelligence")
   applied to BOTH tags and issue-code names, feeding the embedding query +
   keyword terms. Lowering the length filter is necessary but not sufficient.

### Open questions
- Where does the manual override live after leaving capability? (client-level
  column vs. on the LDA mapping vs. a small editor on the intel tab)
- Backfill: re-run aggregation so existing clients get `lda_client.issue_codes`.
- If codes leave capability, embed issue *names* somewhere to keep capability
  embeddings meaningful.

---

## Item 2 — FEC money-flow fixes

**From the 2026-06-05 FEC walkthrough.** Backend `getFecMoneyFlow()`
(`intelligence.service.ts:2297`), panel `FecContributionPanel.tsx`. FEC uses
NO tags and NO issue codes — linkage is purely name/ID matching.

### Bugs
1. **`billCount` always 0 — incompatible ID join.** The committee→bills query
   matches FEC committee IDs (`C00…`) against
   `congress_bill_committee.committee_code`, which is a *congressional* committee
   code (e.g. `hsas00`) — different ID spaces, never match (`service:2394-2407`;
   schema `congress_bill_committee` at `schema.prisma:1744`). ⇒ `billsByCommittee`
   empty → `summary.billCount` always 0 (`service:2480,2491`) → "N associated
   bills" footer never shows (`FecContributionPanel.tsx:249`). **Fix:** derive
   bills via candidate → member (sponsor_name) → sponsored bills, not via FEC
   committee id. Or drop billCount entirely.
2. **"TTM" label is wrong.** Schedule A flow query has NO date/cycle filter
   (`service:2369-2371`) — it sums all loaded cycles — but the panel sub-label
   says "TTM" and the hero says "total matched contributions"
   (`FecContributionPanel.tsx:75,181`). **Fix:** add a real trailing-12-month
   filter or relabel (e.g. "all cycles").

### Shared dependency
3. **`memberCount` relies on sparse `congress_bill.sponsor_name`**
   (candidate_name = sponsor_name, `service:2388`). Same backfill dependency as
   Item 1. Until the sponsor backfill runs on prod, linked-members is
   understated. Also a fragile full-name string match (no FEC candidate_id ↔
   bioguide bridge).

### Enhancement (optional)
4. **Employer match is brittle single-string.** The mapping freezes ONE
   free-text employer value; subsidiaries / spelling variants ("Lockheed",
   "Lockheed Martin Corp") are missed. Consider supporting multiple employer
   aliases per client (array of externalNames, or an alias table) so the flow
   captures the full employer footprint.

### Employer lineage (reference)
- Raw: FEC Schedule A itemized contributions; `contributor_employer` is FREE
  TEXT self-reported by each individual donor → `fec_contribution.contributor_employer`
  (`sync-fec.ts:110`).
- Mapping candidates: `SELECT DISTINCT contributor_employer FROM fec_contribution`,
  trigram `similarity(contributor_employer, clientName) > 0.3`
  (`entity-resolution.service.ts:114-124`).
- Stored on confirm: `clientIntelMapping(source='fec_employer')` with
  `externalId = externalName = contributor_employer` (no stable employer ID — the
  "id" IS the name). `getFecMoneyFlow` reads `externalName` and matches
  `LOWER(contributor_employer) = LOWER(externalName)` (`service:2329,2370`).

---

## Item 3 — Matching quality (cross-cutting)

From the careful audit of the full matching stack (entity resolution →
term-building → retrieval). Tiered by leverage.

### Tier 1 — highest leverage
- **3.1 Entity resolution: exact fingerprint should auto-confirm.**
  `scoreCandidate` (entity-resolution.service.ts:58-74) only boosts exact
  fingerprint matches to 0.70 in the 0.3-0.6 band; auto-confirm needs 0.85, so
  obvious matches ("Acme Corp" vs "Acme Corporation", fp=`acme`) sit unconfirmed
  in the review queue → no LDA mapping → no bills. Fix: exact-fp ⇒ score ≥
  auto-confirm floor regardless of raw trigram band. **(Upstream of all matching.)**
- **3.2 Feed rich client text into the embedding query.** `getTrackedBills`
  builds the query from sector+name+tags only (service:2683); it omits capability
  `description`/`justification`/`districtNexus` and client `description`. Add them
  to allTerms for the embedding query — big recall gain, ~no precision risk
  (cosine-floored). Low risk / high value.
- **3.3 = Item 1 #2: wire issue codes into matching.**

### Tier 2 — real recall gains
- **3.4 Per-topic retrieval.** All terms collapse into ONE query vector
  (service:2878); multi-capability clients get averaged into a centroid. Embed
  per capability/issue and union the results.
- **3.5 Keyword fallback ignores bill TITLE.** `findRelevantBillsByKeyword` /
  `findTrackedBillsByKeyword` match only `congress_bill_subject.name` +
  `policy_area`, not `cb.title` (service:2967-3004). Add title.
- **3.6 No stemming.** Whole-word regex `\m…\M` misses plurals/variants
  (hypersonic≠hypersonics) (service:2968; regs 1848). Move keyword matching to
  Postgres full-text (`tsvector @@ tsquery`, english config).
- **3.7 Acronym/synonym expansion** (= Item 1 #5) also applies to entity
  resolution (IBM≠"International Business Machines" → ~0 trigram, never surfaces)
  and regulations. Shared dictionary.
- **3.8 Regulations have NO embeddings path** (`findActiveRegulations`
  1847-1890 is keyword-only). Add embeddings for `federal_register_document`.

### Tier 3 — coverage (verify on prod) → see Item 5
- **3.9 Embedding coverage gates the primary path.** Bills without a
  `context_embeddings` row are invisible to the embeddings matcher. Verify
  `count(congress_bill)` vs `count(context_embeddings where source_type='bill')`.
- **3.10 Multiple auto-confirms per source = ambiguous reads.** Resolution
  auto-confirms every candidate ≥0.85 (entity-resolution:333-365); the profile
  reads the FIRST confirmed per source (service:205). Keep single best per
  source; force review when top-2 are close.

### Tier 4 — hygiene
- **3.11 `state` fetched but unused** in `scoreCandidate` (entity-resolution:62)
  — use as a disambiguator/tiebreaker boost.
- **3.12 Embedding query carries a non-semantic label** ("Issue-bill tracker
  query: …", service:2878) — drop the internal prefix.
- **3.13 Pinned bills (`trackedBill`) are unused relevance labels** — feed as
  query-by-example exemplars per client.
- **3.14 Reads require confirmed mappings**; a high-confidence (≥0.85)
  unconfirmed match should be usable for reads or surfaced loudly.

---

## Item 4 — Sector tags: KEEP controlled (decision)

Q (2026-06-06): make sector tags free-form for more matches? **Decision: No.**
- `Client.sectorTag` is a controlled enum ON PURPOSE (comment at service:3240
  "already controlled enum"; `SectorTag` type + `normalizeSector`). It powers:
  exact agency-sector ↔ client-sector matching for Federal Register relevance
  (service:3240-3243, `docSectors.has(client.sectorTag)`), portfolio filtering
  (clients.service:62), and defense-profile gating (insight-generator
  `isDefenseProfile`:247). Free-form would BREAK those exact-enum matches and
  fragment the vocabulary — net negative.
- Right division of labor: **sector = controlled facet** (filter/group/categorical
  match); **`tags` = free-form recall** (already wired into matching);
  **descriptions = semantic recall** (Item 3.2). To broaden matching, put the
  breadth in tags + descriptions + synonym expansion (3.7), NOT in sector.

---

## Item 5 — Bill coverage caps (verify, then remediate)

`sync-congress` caps at congresses **117-119**, **50 pages × 100 = 5,000
bills/congress** (sync-congress.ts:31-34). Each congress has ~15-17k
bills+resolutions, so the cap can drop a large tail — and matching can only find
bills that are in the DB.
- **Softeners:** sync is INCREMENTAL (`fromDateTime` since last `updateDate`,
  sync-congress.ts:41/220-235), so steady-state runs fetch only recently-updated
  bills; the 5k cap mainly bites the INITIAL backfill. If the list sort is
  updateDate-desc (**VERIFY — no explicit sort param found in the fetch**), the
  cap keeps the most-active bills and drops dormant ones (acceptable triage).
- **Real gap:** bills beyond the initial-backfill cap that have been dormant
  since before the first sync are permanently missing (incremental only
  re-fetches *updated* bills); plus resolutions and pre-117 congresses.
- **Do NOT just remove the cap** (it protects sync time + Bedrock embed cost). Plan:
  1. **Verify coverage (cheap — do first):** prod count `congress_bill` per
     congress vs Congress.gov totals; confirm the `/bill` list sort param.
  2. **Force sort = updateDate desc** so the cap always retains active bills.
  3. **One-time full backfill of the current congress (119)** with a raised cap
     (API limit ~5k/hr makes this feasible over a few hours).
  4. **Tiered ingestion:** full bill *metadata* for ALL bills (cheap → full
     keyword-match universe) + embeddings only for the active/relevant subset
     (controls Bedrock cost). Decouples coverage from embed spend.

---

<!-- Append further items below as we investigate. -->


