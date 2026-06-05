# Spec: PE → Contractor Linkage (make the "Top Contractors" panel populate)

Status: PROPOSED (data-engineering task, no UI work needed)
Owner: TBD
Author: investigation handoff
Last updated: 2026-06-04

---

## 1. Problem (what the user sees)

On the Program Element detail view (Intelligence tab), the **"Contracts associated with this PE" / "Top Contractors"** panel is **empty for every PE**. It is not a deploy bug, not a stale image, not an RLS issue. The endpoint works; it has nothing to return.

## 2. Root cause (verified against code + schema + prior data probe)

The panel calls `GET /program-elements/:peCode/contractors` →
`ProgramElementReadService.getContractors(peCode)`
(`apps/api/src/program-element/program-element-read.service.ts:345-392`).

That query is correct:
```
SELECT contractor_name, SUM(amount)/1e6 AS total_m, COUNT(*) AS awards
FROM federal_award
WHERE pe_code = $peCode
  AND contractor_name IS NOT NULL
  AND COALESCE(action_date, awarded_at::date) >= (NOW() - INTERVAL '24 months')
GROUP BY contractor_name ORDER BY total_m DESC LIMIT 10
```

It returns nothing because **`federal_award.pe_code` is NULL on ~all rows.**

Why it's NULL — the ingestion path, end to end:
- `scripts/sync-federal-award.ts` pulls DoD contract awards from USAspending v2
  `search/spending_by_award` (award_type_codes A/B/C/D).
- For each award it calls
  `AwardPeExtractorService.extractPeCode({ description }, knownPeCodes)`
  (`apps/api/src/program-element/extractors/award-pe-extractor.service.ts`).
- The extractor resolves a PE **only** if either (1) an explicit `program_element`/`pe_code`
  field is present (USAspending does **not** provide one for contracts), or (2) the award
  `description` literally contains a `^\d{7}[A-Z][A-Z0-9]*$` token (e.g. `0204134N`) that is
  also a known PE.
- USAspending contract descriptions essentially never contain that token. Prior probe:
  **0 of 2000** sampled descriptions carried a PE code. So the extractor returns `null`,
  `pe_code` stays NULL (by design — not quarantined), and the panel is empty.

Confirmed dead ends (do NOT pursue):
- Re-running `sync-federal-award` — same source, same null result.
- `program_element_procurement_line` — has `pe_code` + dollars/quantity but **no
  `contractor_name`** column; it's R-2A budget sub-lines, not awards. Not a contractor source.

## 3. Goal / acceptance

`federal_award.pe_code` is populated for a **meaningful, demo-defensible share** of DoD
RDT&E / procurement awards, via a real crosswalk — so that opening a high-profile PE
(e.g. an aircraft or missile PE the client tracks) shows its top contractors with
24-month award dollars. No invented numbers; coverage must be measurable and honest.

Definition of done:
- A new/extended enrichment job resolves PE for awards using a real linkage signal
  (below), validates against `program_element`, and upserts `federal_award.pe_code`.
- A read-only coverage metric exists (count of `pe_code IS NOT NULL`, and % of DoD
  RDT&E awards) surfaced in logs / a diagnostic verb, so we can state coverage truthfully.
- `getContractors` returns rows for at least the set of PEs the linkage can resolve.
- Tests: extractor/crosswalk unit tests with real-shaped fixtures; no regression in
  district enrichment.

## 4. Approach — ranked linkage options (pick during scoping)

The missing link is "which contract belongs to which PE." Ranked by signal quality vs effort:

### Option A — Treasury Account / Program-Activity crosswalk (RECOMMENDED, strongest)
USAspending exposes, per award, the funding **Treasury Account Symbol (TAS)** and
**Program Activity** under `search/spending_by_award` extended fields or the award-detail
`/api/v2/awards/{id}/` + `federal_account` endpoints. RDT&E PEs map to program activities
inside RDT&E appropriation accounts. Build a TAS/program-activity → PE crosswalk from the
J-book data we already ingest (`program_element` + `program_element_year`, appropriation
+ budget-activity fields), then attribute awards by their funding account.
- Pros: real funding linkage, not text matching; defensible.
- Cons: requires pulling the funding-account fields (extra USAspending call or extended
  field set) and building the crosswalk table. Many-to-one (account→several PEs) needs a
  disambiguation rule (budget line / sub-activity).

### Option B — Recipient (UEI) × PE-known-contractor heuristic (medium)
For PEs where the J-book / P-docs name a prime (some R-docs list the performing
contractor), match `federal_award.recipient_uei`/`contractor_name` to that prime within the
PE's appropriation account + fiscal window. Narrower but high-precision where it fires.
- Pros: cheap if we already have prime names; high precision.
- Cons: low coverage; only PEs with a named prime.

### Option C — PIID / contract-vehicle crosswalk (medium, if data exists)
If any J-book/procurement source ties a PE to specific PIIDs/contract numbers, join on
`federal_award.piid`. Exact when present.
- Pros: exact join.
- Cons: depends on a PE→PIID list we may not have.

### Option D — keep description regex, broaden inputs (weak, do NOT rely on alone)
Pull additional USAspending text fields (e.g. `Description` + transaction-level
`program_activity` text) into the extractor. Marginal lift; keep only as a fallback tier.

Recommended build order: **A as primary, B as a high-precision overlay, D as last-resort
fallback.** Each tier writes a `pe_code_source` so coverage is auditable per method.

## 5. Schema changes

- `FederalAward`: add `peCodeSource String? @map("pe_code_source")` (e.g.
  `tas_crosswalk` | `prime_uei` | `piid` | `description_regex`) + index. Lets us report
  coverage by method and trust level, and lets the UI label provenance.
- New `TasProgramElementCrosswalk` table (Option A): `(tas, programActivity, peCode, fy,
  confidence, source)`, unique on `(tas, programActivity, peCode, fy)`, global/no-RLS like
  the other federal tables. Built from J-book ingest.
- Migration follows the repo's confirmed deploy rule: migrate task def **pins a specific
  image SHA**, not `:latest` — dump td → swap image to the just-pushed tag → strip
  read-only fields → register → run → verify "All migrations have been successfully
  applied." (see skill `deploy-rollout-and-scheduled-jobs.md`).

## 6. New / changed code

- `scripts/sync-federal-award.ts`: request the funding-account/program-activity fields (or
  add a second award-detail fetch for awards missing them).
- `src/program-element/extractors/award-pe-extractor.service.ts`: extend to a **tiered**
  resolver — explicit → TAS/program-activity crosswalk → prime-UEI overlay → PIID →
  description regex; return `{ peCode, source }`.
- New `scripts/enrich-award-pe.ts` (mirror of `enrich-award-districts.ts`): backfill
  `pe_code` + `pe_code_source` over existing `federal_award` rows in batches, idempotent,
  `--limit` arg, logs coverage before/after. Register as an ECS task def pointing at
  `:latest` (same pattern just applied to `capiro-dev-api-enrich-districts:5`).
- Add a read-only `report-award-pe-coverage` entrypoint verb (counts + % by source) so
  coverage can be stated without direct Aurora access (the container entrypoint rejects
  ad-hoc `sh`/SQL, so a real verb is the only way to query live).

## 7. Tests

- Unit: tiered extractor with fixtures for each tier (TAS hit, prime-UEI hit, PIID hit,
  description regex hit, and a no-match → null). Assert `source` label.
- Unit: crosswalk builder from sample J-book rows (many-to-one disambiguation).
- Regression: district enrichment unaffected.
- No live deploy in this task without explicit go-ahead.

## 8. Honest framing for demo / client

Until linkage ships, the Top Contractors panel should either be hidden for PEs with zero
resolved awards or show an explicit "contractor attribution coming soon — federal award
data is being linked to this program element" state, rather than a silent empty box.
Decide this with the UI owner. Do **not** fabricate contractor rows.

## 9. Open questions (resolve at scoping)

1. Does our current J-book ingest carry appropriation + budget-activity + program-activity
   granularity needed to build the TAS→PE crosswalk? (Check `program_element_year` raw
   JSON.)
2. Acceptable coverage bar for "good enough to ship" (e.g. ≥X% of DoD RDT&E award dollars)?
3. Confidence threshold for showing a contractor row vs suppressing low-confidence matches.
