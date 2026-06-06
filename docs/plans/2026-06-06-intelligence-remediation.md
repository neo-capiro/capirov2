# Intelligence Tab — Remediation & Matching Overhaul

Branch: `fix/intel-matching-and-help`. Production work — verified locally
(deploys here are manual). **Status as of 2026-06-06.**

Verified green: `@capiro/api` typecheck, `@capiro/web` typecheck, **API jest
639/639**, **web vitest 89/89**, prettier-clean on all newly-authored files.
Diff is intentionally minimal (~340 changed lines + 5 new files). NOTE: the repo
was never prettier-conformant (even untouched files fail `prettier --check`), so
`prettier --write` was deliberately NOT run across pre-existing files — edits
match the surrounding style instead, keeping the diff reviewable.

---

## DONE (this branch)

### Matching quality (api)
- **Issue codes feed matching.** `getTrackedBills` now builds two term sets: a
  precise `keywordTerms` (sector, tags, capability-name words) for the whole-word
  keyword matcher, and a rich `embeddingParts` (capability name + description +
  justification + district nexus) for the semantic matcher. LDA issue-names feed
  both. (`intelligence.service.ts`)
- **Acronym/synonym expansion.** New `intelligence/term-expansion.ts` maps
  defense/gov acronyms → phrases (EW→electronic warfare, C2, ISR, UAS, UAV, PNT,
  AI, …) so a short client tag reaches the full-phrase bill-subject vocabulary.
  Known acronyms survive the keyword length filter; unknown <4-char tokens are
  still dropped to avoid noise. (+ `term-expansion.spec.ts`)
- **Bill title in the keyword fallback.** All four keyword WHERE clauses now also
  match `cb.title` (was subjects + policy_area only).
- **Dropped the non-semantic embedding-query prefix** ("Issue-bill … query:").

### Entity resolution (api)
- **Exact multi-token fingerprint → auto-confirm** (rescues "Acme Defense Corp" vs
  "…Corporation"); single-token exact stays review (ambiguous).
- **Single best per source auto-confirms**, and only when clearly ahead of the
  runner-up (ambiguity margin) — no more multiple silent auto-confirms per source.
- Extracted **`candidateDecision()`** as the single source of truth (skip/review/
  auto_confirm), shared by the service and the write-floor spec. Never downgrades
  a human-confirmed mapping. (`entity-resolution.service.ts` + updated spec)

### FEC money-flow (api)
- **`billCount` fixed.** Was always 0 — it joined FEC committee IDs (`C00…`)
  against congressional committee codes (`hsas00`). Now bills link the sound way:
  recipient candidate → bill sponsor (`sponsor_name`). (+ `intelligence.fec-money-flow.spec.ts`)
- **Rolling 24-month window** on the Schedule A flow + accurate "last 24 months"
  label (the old "TTM" label was false — the query had no date bound).

### Capability issue-code dropdown removed (web + api)
- Removed from `CapabilityDrawer`, the Add-Capability modal, capability cards, and
  the `client-capabilities.service` write path. (Auto LDA issue codes already drive
  matching; free-form tags serve as the manual override.) The
  `client_capability.issue_codes_jsonb` column is left dormant (non-destructive).

### Lobbyist help tooltips (web)
- Reusable `HelpTip` (antd Tooltip + "?" icon, keyboard-accessible) + centralized
  `intelligence-v1/help-content.ts` with plain-English, non-technical explainers
  (what it is · how it's calculated · how to act). Wired into: Office Recommender
  header + **every tag** (with readable labels + best-practice copy), Return Ratio,
  FEC, District Nexus, Bill Pipeline, Regulatory Lifecycle, Activity.

---

## REMAINING (deferred — prod data ops or a later code cycle)

1. **Run `backfill-bill-sponsors.ts` on prod** + ensure the Congress sync fetches
   bill *detail*. This flips the sponsor-based office recommender AND FEC
   `memberCount`/bill linkage from sparse → live. *(prod op)*
2. **Bill coverage caps**: sync caps at congresses 117–119, 5,000 bills/congress.
   Verify `congress_bill` counts vs Congress.gov, confirm/force `updateDate desc`
   sort so the cap keeps active bills, one-time full backfill of the 119th, and
   consider tiered metadata-vs-embedding ingestion. *(sync change + prod op)*
3. **Office-specific district/FEC weights** in the sponsor recommender — today
   they are client-level constants applied to every office equally. *(code)*
4. **Office recommender drill-through** still targets the issue leaderboard with an
   ignored `office=` param — needs a real office/committee detail destination
   (product decision) or should be de-linked. *(UX decision)*
5. **Per-topic embedding retrieval** (multi-capability clients get averaged into
   one centroid) + **embeddings path for regulations** (today keyword-only). *(code)*
6. **Dormant/unused data**: drop `client_capability.issue_codes_jsonb` + its
   `embedder.ts` read in a future migration; SEC/FARA mappings are resolved but
   unconsumed by the intel tab; grants/state/BEA empty (BEA key inactive). *(mixed)*
