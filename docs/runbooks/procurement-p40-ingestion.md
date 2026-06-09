# Procurement (P-1/P-40) ingestion — handoff runbook

Goal: load the **FY2027 Army procurement** books (Aircraft, Missile, W&TCV, Ammo,
Other Procurement BA1–4) into the system as `appropriation_type='PROC'` program
elements with FY request dollars + quantities + line items.

## 0. Prereqs / context (already DONE, on `main`)
- **Loader (Option A)** is on main + in the deployed image: `isValidProgramCode`
  accepts procurement **BLINs** (`^[0-9]{4}[A-Z]{1,2}[0-9A-Z]{4,5}$`) as well as
  RDT&E PE codes; `pdoc-parser` loads parent BLIN → `program_element`
  (`appropriation_type='PROC'`, `service`) + `program_element_year` (request $ in
  millions) + `program_element_procurement_line` (child items). Garbage codes
  quarantine.
- **Extractor fix** is on main (commit `f9d2504`): `scripts/__tools__/extract_pdoc.py`
  now anchors FY-column detection to the Resource Summary header row and handles
  the `FY2027 Base/OOC/Total` split. Verified value-for-value on the Aircraft book.
- **Source PDFs**: 7 Army FY2027 procurement books in `C:\Users\neoma\Downloads\`.
- **Env**: Python 3.11 + `pdfplumber` 0.11.9 are installed locally. Local Postgres
  is the Docker container `capiro-postgres` (`pgvector/pg16`, `capiro:capiro` @
  `127.0.0.1:5432`).

**FIRST: `git pull` (origin/main) so you have `f9d2504` + the Option A loader.**

## 1. Extract all 7 books (offline, local — run from `apps/api/`)
Each writes a committed-style artifact into `scripts/__data__/`. `--fy 2027` (the
books are "PB 2027 Army"); request year = the FY2027 **Total** (Base+OOC) column.

```bash
cd apps/api
EX() { python scripts/__tools__/extract_pdoc.py "/c/Users/neoma/Downloads/$1" --service ARMY --fy 2027 --out "scripts/__data__/pdoc_army_$2_fy2027.json"; }
EX "Aircraft_Procurement_Army.pdf"                                              aircraft
EX "Missile Procurement Army.pdf"                                              missile
EX "Procurement_of_Weapons_and_Tracked_Combat_Vehicles.pdf"                    wtcv
EX "Procurement_of_Ammunition.pdf"                                             ammo
EX "Other Procurement - BA1 - Tactical & Support Vehicles.pdf"                 op_ba1
EX "Other_Procurement - BA2 - Communications & Electronics.pdf"                op_ba2
EX "Other Procurement - BA3 & 4 - Other Support Equipment & Initial Spares.pdf" op_ba3_4
```

## 2. Verify each artifact BEFORE loading (this is the quality gate)
```bash
python -c "
import json,glob,os
for f in sorted(glob.glob('scripts/__data__/pdoc_army_*_fy2027.json')):
    d=json.load(open(f)); pes=d.get('pes',[])
    fys=sorted({r['fy'] for p in pes for r in (p.get('fyData') or []) if r.get('fy')})
    print(os.path.basename(f), 'BLINs=%d'%len(pes), 'FYs=%s'%fys)
"
```
**PASS criteria per book:**
- FY list is exactly `[2025, 2026, 2027, 2028, 2029, 2030, 2031]` (or a clean
  contiguous subset) — **no junk years** (2008/2015/2017 etc. = the header bug).
- BLIN count is sane (Aircraft=31, Missile=25, W&TCV=31; others tens–low-hundreds).
- Spot-check one BLIN's FY2027 request against the PDF's `Net Procurement (P-1)`
  row (e.g. Aircraft Small UAS `9678A12500` FY2027 = `291.472`M → `reqK=291472`).

**If a book shows junk years or empty FYs**, its layout differs (e.g. no OOC
column). Fix `_fy_header_columns` in `extract_pdoc.py`: the anchor requires
`Years`+`Base`+`Total` on the header row — loosen/adjust for that book's header,
re-extract, re-verify. Do NOT load a book that fails this gate.

## 3. (Recommended) Load to a scratch DB to confirm end-to-end
```bash
# fresh scratch DB with all migrations
docker exec -e PGPASSWORD=capiro capiro-postgres psql -U capiro -d postgres -c "DROP DATABASE IF EXISTS capiro_pdoc_scratch; CREATE DATABASE capiro_pdoc_scratch;"
docker exec -e PGPASSWORD=capiro capiro-postgres psql -U capiro -d capiro_pdoc_scratch -c 'CREATE EXTENSION IF NOT EXISTS "uuid-ossp"; CREATE EXTENSION IF NOT EXISTS "citext"; CREATE EXTENSION IF NOT EXISTS "pg_trgm"; CREATE EXTENSION IF NOT EXISTS "vector";'
export DATABASE_URL="postgresql://capiro:capiro@127.0.0.1:5432/capiro_pdoc_scratch"
npx prisma migrate deploy
for a in aircraft missile wtcv ammo op_ba1 op_ba2 op_ba3_4; do
  npx tsx scripts/parse-pdoc-army.ts --artifact "scripts/__data__/pdoc_army_${a}_fy2027.json" --service ARMY --fy 2027
done
docker exec -e PGPASSWORD=capiro capiro-postgres psql -U capiro -d capiro_pdoc_scratch -At -c "
SELECT 'PROC PEs='||count(*) FROM program_element WHERE appropriation_type='PROC';
SELECT 'PROC years='||count(*) FROM program_element_year y JOIN program_element pe ON pe.pe_code=y.pe_code WHERE pe.appropriation_type='PROC';
SELECT 'proc lines='||count(*) FROM program_element_procurement_line;
SELECT 'quarantined='||count(*) FROM program_element_quarantine WHERE source LIKE 'p_doc_%';"
```
Expect: PROC PEs ≈ sum of BLIN counts, quarantined ≈ 0, request $ in plausible
millions (not 1000× off).

## 4. Commit the artifacts
```bash
git add apps/api/scripts/__data__/pdoc_army_*_fy2027.json
git commit -m "data(procurement): FY2027 Army P-40 extraction artifacts (7 appropriations)"
# rebase onto origin/main if needed, then push to main
```
CI then builds `:latest` with the artifacts baked into the image.

## 5. Load on PROD (after CI builds `:latest` from the artifact commit)
`parse:pdoc` runs on the data-runner and reads the artifact **from the image**, so
the artifacts MUST be committed + CI green first. Run one task per artifact:
```bash
pnpm --filter @capiro/api parse:pdoc -- --service ARMY --artifact scripts/__data__/pdoc_army_aircraft_fy2027.json --fy 2027
# …repeat for missile / wtcv / ammo / op_ba1 / op_ba2 / op_ba3_4
```
Then `deltas:compute --commit` (so procurement years get deltas) and, if desired,
`generate:actions --commit`.

Verify on prod: `SELECT count(*) FROM program_element WHERE appropriation_type='PROC';`
should be > 0, and the PE pages should show procurement programs with sane $M.

## Caveats
- **Army only.** The extractor is tuned to the Army P-40 layout. Navy/AF/SF/USMC
  books have different layouts and need `extract_pdoc.py` adapted per service
  (separate effort).
- Request year = **FY2027 Total** (Base+OOC). FY2025/26 = prior actuals; FY2028–31
  = FYDP. Change in `_parse_p40` (`total_x` → `BASE`) if Base-only is wanted.
- Procurement PEs participate in PE→Program matching by title (the generic-alias
  stoplist protects against false matches).

## Secondary Distribution per-recipient values (FY2027 — DONE 2026-06-09)
`_parse_secondary_distribution` now captures per-recipient (Army/ANG/AR/…) quantity
+ obligation-authority for the request year. Two fixes vs. the original null-dropping
parser: (1) resolve the request-year column from the SD block's OWN header (first
'Total' = request-year Base+OOC; the columns usually share the 'Secondary
Distribution' label row), page header as fallback; (2) select the value by POSITIONAL
index in the header's ordered value-columns, NOT nearest-x — header labels and
right-aligned data drift apart (e.g. a short quantity token lands ~24px off the
'Total' header), which silently dropped quantities while dollars matched.

Verified against the PDF before load: NGSW Army 16,132/$159.166M, ANG 22,009/$213.475M
(WTCV p166); Lower Tier AMD Army qty 12/$2,036.358M (Missile p30). Re-extracted all 7
books and LOADED TO PROD (capiro-dev) 2026-06-09 via `parse-pdoc` ECS tasks — 197 line
items upserted, 0 quarantined across all 7. Per-book lineItems: aircraft 35, missile
21, wtcv 37, ammo 1, op_ba1 12, op_ba2 59, op_ba3_4 32.

KNOWN per-book coverage notes (NOT bugs):
- **ammo**: only 1 line item — the Ammunition book has Secondary Distribution on just
  1 of 921 pages (bulk-funded, no per-recipient split). Correct, not a parser gap.
- **aircraft**: low quantity coverage (2/35 qty, 21/35 dol) — likely an SD layout
  variant; revisit with the same dump+diagnose cycle if per-recipient aircraft
  quantities are needed. Dollars populate fine.
