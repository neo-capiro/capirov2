# Procurement (P-40) extractor — per-Service tuning runbook (Navy / AF / SF / USMC)

Companion to `procurement-p40-ingestion.md`. That runbook loaded the **Army** FY2027
P-40 books (live in prod: 247 PROC PEs, 0 quarantined). This one is the playbook for
extending `scripts/__tools__/extract_pdoc.py` to the other Services.

## 0. Status / blocker
- **Army:** DONE — extractor tuned + verified value-for-value; 7 books in prod.
- **Navy / AF / SF / USMC:** NOT STARTED. **Blocked on source PDFs** — as of this
  writing only the 7 Army books are in `C:\Users\neoma\Downloads\`. No non-Army P-40
  books are present and only `parse-pdoc-army.ts` exists (no per-service loader).
- You cannot tune or verify a layout you can't see. **Get the books first.** Public
  source: DoD Comptroller (comptroller.defense.gov) FY2027 "J-Books" → each Service's
  Procurement (P-1) justification volumes. Drop them in `Downloads\`.

## 1. What is actually Service-specific (the real work)
`--service` is **only a label** today (stored in the artifact + used by the loader for
the `p_doc_<service>_fy<NN>` source tag). It does NOT branch the parser. All parsing is
**geometric + Army-string-anchored**, so each new Service is a layout-tuning exercise,
not a flag. The Army-coupled assumptions, by line in `extract_pdoc.py`:

| Assumption | Line(s) | Army value | Why it may differ per Service |
|---|---|---|---|
| Page gate | `_is_p40_page` ~103 | `"Exhibit P-40"` + `"Budget Line Item Justification"` | Standard OSD exhibit — should hold for all Services. Verify anyway. |
| **FY header anchor** | `_fy_header_columns` ~125 | requires `Years` **and** `Base` **and** `Total` on one row | **THE big one.** Books with **no OOC/Base split** (single request-year column) have no `Base` token → anchor returns `{}` → empty/junk FYs. This is the exact failure the main runbook warns about. |
| Request-year column | `_parse_p40` ~217-220 | first `Total` (Base+OOC); falls back to `("FY", str(fy))` | Fallback already handles single-column books **iff** the header anchor still fires — but the anchor needs `Base`+`Total`, so a no-Base book never reaches the fallback. Anchor must be loosened (see §3). |
| Resource Summary row labels | ~236-241 | `Procurement Quantity`, `Net Procurement (P-1)`, `Total Obligation Authority` (fallback), `Gross/Weapon System Unit Cost` | Label wording is largely OSD-standard but **confirm exact strings** per Service (esp. unit-cost row; Shipbuilding/SCN often lacks a quantity/unit-cost row entirely). |
| BLIN regex | `BLIN_RE` ~75 | `^[0-9]{4}[A-Z]{1,2}[0-9A-Z]{4,5}$` | Permissive (1-2 service letters) — should cover Navy (`N`), AF (`F`), SF, USMC. **Verify against real codes**; widen `{1,2}` only if a Service uses a longer designator. |
| Footer/header BLIN anchors | `LI_FOOTER_RE` ~77, `HEADER_CODE_RE` ~79 | `LI <BLIN> - <Title>` / `<BLIN> / <Title>` | OSD-standard footer. Verify. |
| Units | ~263-266 | Net Procurement in **Millions**, Unit Cost in **Thousands** | OSD-standard. **Spot-check** — a units error is silently 1000× off. |
| Secondary Distribution | `_parse_secondary_distribution` ~276 | recipient rows `… Quantity …` + `Total Obligation Authority …`, $ in Millions | Recipient naming differs (Navy: TYCOMs/SYSCOMs; AF: MAJCOMs). Child line items are nice-to-have, not gating — don't block a load on these. |
| **Shipbuilding (SCN)** | n/a | — | Navy SCN (P-40 for ships) has a **very different shape**: 1 hull = huge multi-year split-funding tables, advance procurement, no per-unit "quantity" the way aircraft/missile do. Treat SCN as its **own** sub-effort; don't assume the Army geometry maps. |

## 2. The workflow (per Service, per book) — verify-driven, same as Army
For each Service `S` (NAVY|AF|SF|USMC) and each book:
```bash
cd apps/api
python scripts/__tools__/extract_pdoc.py "/c/Users/neoma/Downloads/<BOOK>.pdf" \
  --service S --fy 2027 --out "scripts/__data__/pdoc_<s>_<tag>_fy2027.json"
```
Then run the **same quality gate** as the Army runbook §2 (a copy lives at
`/tmp/verify_pdoc.py` from the Army run — note the artifact field is
`requestDollarsThousands`, not `reqK`):
- FY list must be a clean contiguous subset of `[2025..2031]` — **no junk years**.
- BLIN count sane for that book.
- **Spot-check one BLIN's FY2027 request vs the PDF's `Net Procurement (P-1)` row**
  (value-for-value, like Army Small UAS `9678A12500` = `291.472`M).
- **Do NOT load any book that fails the gate.** Junk/empty FYs = the header layout
  differs → fix `_fy_header_columns` (§3), re-extract, re-verify.

## 3. The most likely fix: loosen the FY-header anchor for no-OOC books
The anchor (`_fy_header_columns`, ~125) hard-requires `Base` AND `Total`. A book whose
request year is a **single column** (no Base/OOC contingency split) has no `Base` token,
so `hdr` stays `None` → `{}` → no `emit_years` → empty artifact / junk-year fallback.

Tune **without breaking Army** — make the anchor tiered, most-specific first:
1. `Years` + `Base` + `Total`  → Army-style Base/OOC/Total (current).
2. `Years` + `Total` (no `Base`) → single request-year `Total` column.
3. A row with ≥3 `20\d\d` tokens + a request-year column → plain single-column books.
Keep the **first** `Total` as the request-year total, the rightmost as `GRANDTOTAL`
(don't emit it). Re-confirm Army still produces identical artifacts (regression guard)
before committing — re-extract aircraft and diff against the committed
`pdoc_army_aircraft_fy2027.json`.

## 4. Loader side
`parse-pdoc-army.ts` is **already Service-parameterized** — it takes `--service` and the
writer tags rows `p_doc_<service>_fy<NN>`. The container entrypoint dispatch
`parse-pdoc) … parse-pdoc-army.ts "$@"` is generic. So **no new loader is needed**;
the file name is just legacy. Run e.g.
`parse-pdoc --service NAVY --artifact scripts/__data__/pdoc_navy_<tag>_fy2027.json --fy 2027`.
(Consider renaming `parse-pdoc-army.ts` → `parse-pdoc.ts` later; cosmetic, defer.)

## 5. Prod load (identical mechanism to Army §5)
After committing verified artifacts to main + CI green (`:latest`):
```bash
# ECS run-task on capiro-dev, td capiro-dev-api-migrate, container "api",
# image :latest, network = the capiro-dev-api service's subnets/SG (assignPublicIp DISABLED).
# command override: ["parse-pdoc","--service","NAVY","--artifact","<art>","--fy","2027"]
```
Net config used for Army (re-verify it hasn't drifted via
`aws ecs describe-services --cluster capiro-dev --services capiro-dev-api`):
- subnets: `subnet-0e38bd390f8961fef, subnet-0920665f91c905f01, subnet-06db79cd21239de19`
- sg: `sg-01def4e5c0fe44d4a`
Then run `emit-changes` (the container's delta/change emitter — there is **no**
`deltas:compute` token; the loader emits IntelligenceChange inline and `emit-changes`
reconciles). Logs land in CloudWatch group `/capiro/dev/api`, stream `api/api/<taskId>`.
Verify each task `exitCode=0` and the loader summary line
`<n> PEs, … , 0 quarantined`.

## 6. Caveats / order of attack
- Easiest first (Army-like geometry): **Air Force** and **USMC** aircraft/missile/ammo/
  weapons books. **Navy** non-ship books next. **Navy Shipbuilding (SCN)** last and as a
  separate spike — its table shape is genuinely different.
- A units bug (Millions vs Thousands) is the highest-risk silent error → always include
  a value-for-value spot-check in the gate, never just a count/FY-range check.
- Keep extraction **offline** (pdfplumber only) — no Firecrawl/LLM in the path.
- Large books are slow + memory-hungry under pdfplumber (Army op_ba3_4 hit ~3GB RAM /
  ~40 min). Run multi-book extraction in the background, not a single foreground call.
