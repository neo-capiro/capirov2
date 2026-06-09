#!/usr/bin/env python
"""
Offline DoD P-Doc (Procurement budget justification) extractor — Step 27.

Deterministic pdfplumber extraction — same pattern as the R-2 J-book / committee
tools. Turns a Service procurement book PDF (Aircraft/Missile/Weapons/Other
Procurement, Shipbuilding, etc.) into a JSON artifact consumed by
scripts/parse-pdoc-<service>.ts. NO Firecrawl/LLM in the path — the deterministic
pass is the trustworthy one for procurement quantities + dollars.

Usage:
  python extract_pdoc.py BOOK.pdf --service ARMY --fy 2026 \
      --source-url "https://.../Aircraft_Procurement_Army.pdf" \
      --out ../__data__/pdoc_army_aircraft_fy2026.json

Output schema:
  { "service": "ARMY", "fy": 2026, "sourceUrl": "...",
    "pes": [ { peCode, title, budgetActivity, lineNumber, programOfRecord,
               fyData:[{fy,quantity,requestDollarsThousands,unitCostDollars}],
               lineItems:[{description,fy,quantity,dollars}] } ] }

PROCUREMENT-BOOK LAYOUT (what this parses)
==========================================
Procurement justification books are NOT organized by 7-digit + service-letter
RDT&E PE codes. They are organized by *weapon-system line items* identified by a
**P-1 Line Item Number / Budget Line Item Number (BLIN)** — a ~10-character code
such as ``9670A00005`` (MQ-1 UAV) or ``6771AA0005`` (UH-60 Blackhawk). The book
contains, per line item, one **Exhibit P-40 (Budget Line Item Justification)**:

  Exhibit P-40, Budget Line Item Justification: PB 2026 Army  Date: June 2025
  Appropriation / Budget Activity / Budget Sub Activity:   P-1 Line Item Number / Title:
  2031A: Aircraft Procurement, Army / BA 01: Aircraft ...   9670A00005 / MQ-1 UAV
  ...
  Resource Summary            Prior  FY2024  FY2025  FY26 Base  OOC  FY26 Total  FY27 ... Total
  Procurement Quantity ...      322      0       8        -      -        -      ...
  Net Procurement (P-1) ($ in Millions)  4,211.987  -  240.000  ...
  Gross/Weapon System Unit Cost ($ in Thousands)  13,080.705 - 30,000.000 ...
  ...
  LI 9670A00005 - MQ-1 UAV                                      (page footer)

This extractor keys each P-40 exhibit by its BLIN (-> ``peCode``), uses the item
title as ``title``, and reads the labelled Resource Summary rows for the
requested FY (and neighbouring fiscal years) to build ``fyData``:
  - quantity                <- "Procurement Quantity (Units in Each)"
  - requestDollarsThousands <- "Net Procurement (P-1) ($ in Millions)" * 1000
                               (the loader's thousandsToMillions divides by 1000,
                                so we re-express the P-40 millions as thousands to
                                round-trip to the canonical MILLIONS unit)
  - unitCostDollars         <- "Gross/Weapon System Unit Cost ($ in Thousands)"
                               * 1000  (thousands -> dollars)

Child sub-rows (``lineItems``) are taken from the P-40 "Secondary Distribution"
block (per-recipient quantity + obligation authority) when present.

DOLLAR UNITS: P-40 Resource Summary dollar rows are denominated in MILLIONS;
quantities are units; unit cost is in THOUSANDS. We convert to the units the
loader's parser expects (requestDollarsThousands == thousands; unitCostDollars ==
full dollars) so the downstream thousandsToMillions normalisation yields correct
millions. P-1 detail pages (the cross-line summary table) are in THOUSANDS and are
used only as a fallback when no P-40 quantity/dollar is present.

Robust/general across Service procurement books (Aircraft/Missile/Weapons/Other
Procurement, Shipbuilding). BLINs are matched generically (4 digits + 1-2 service
letters + digits), so the same tool handles every Service's P-40 book.
"""
import argparse
import json
import re
import sys

# --- BLIN / P-1 Line Item Number -----------------------------------------
# Army aircraft examples: 9670A00005, 6771AA0005, 3632AZ3504. General DoD form:
# 4 leading digits, a 1-2 char service/sub designator, then digits — 10 chars
# total. Kept permissive (1-2 letters) to cover every Service's procurement book.
BLIN_RE = re.compile(r"^[0-9]{4}[A-Z]{1,2}[0-9A-Z]{4,5}$")
# Footer anchor on every P-40 page: "LI <BLIN> - <Title>"
LI_FOOTER_RE = re.compile(r"\bLI\s+([0-9][0-9A-Z]{8,11})\s*-\s*(.+)$")
# Header line carrying the authoritative "<BLIN> / <Title>" pair.
HEADER_CODE_RE = re.compile(r"\b([0-9]{4}[A-Z]{1,2}[0-9A-Z]{4,5})\s*/\s*(.+)$")

AMOUNT = r"\(?-?\$?[\d,]+(?:\.\d+)?\)?"
AMOUNT_RE = re.compile(AMOUNT)


def parse_num(token):
    if token is None:
        return None
    t = str(token).strip()
    if not t or t == "-":
        return None
    neg = t.startswith("(") and t.endswith(")")
    cleaned = re.sub(r"[(),$\s]", "", t)
    if cleaned in ("", "-"):
        return None
    try:
        n = float(cleaned)
    except ValueError:
        return None
    n = -n if neg else n
    return int(n) if n == int(n) else n


def _is_p40_page(text):
    return "Exhibit P-40" in text and "Budget Line Item Justification" in text


def _fy_header_columns(words):
    """Map fiscal-year + the FY26 sub-columns to x-centres from the Resource
    Summary header rows. Returns dict label -> x_center. Labels include integer
    fiscal years ("2024".."2030"), plus "BASE"/"OOC"/"TOTAL" for the request year,
    "PRIOR", "COMPLETE", and a final "GRANDTOTAL"."""
    # Header tokens sit on two stacked rows (e.g. "FY"/"2026" and "Base").
    cols = {}
    for w in words:
        txt = w["text"]
        xc = (w["x0"] + w["x1"]) / 2.0
        top = w["top"]
        if re.fullmatch(r"20[0-9]{2}", txt):
            cols.setdefault(("FY", txt, round(top)), xc)
        elif txt in ("Base", "OOC", "Total", "Prior", "Complete", "Years"):
            cols.setdefault((txt.upper(), round(top)), xc)
    return cols


def _row_words(words, top, tol=3.0):
    return sorted((w for w in words if abs(w["top"] - top) <= tol), key=lambda w: w["x0"])


def _group_rows(words, tol=2.5):
    rows = {}
    for w in words:
        key = None
        for k in rows:
            if abs(k - w["top"]) <= tol:
                key = k
                break
        rows.setdefault(key if key is not None else w["top"], []).append(w)
    return [sorted(v, key=lambda x: x["x0"]) for _, v in sorted(rows.items())]


def _nearest_value(num_words, x_center, max_dist=22.0):
    """Pick the numeric token whose right-aligned position is closest to a column
    centre. Budget tables right-align numbers, so compare to the token's x1."""
    best, best_d = None, max_dist
    for w in num_words:
        # right-aligned: column centre roughly tracks the token's right edge minus
        # half its width; comparing to the token centre is close enough at our tol.
        d = abs(((w["x0"] + w["x1"]) / 2.0) - x_center)
        if d < best_d:
            best, best_d = w, d
    return best


def _parse_p40(words, fy):
    """Parse one P-40 exhibit page's word list into (blin, title, fyData rows,
    lineItems). Resource Summary rows are read by FY column geometry."""
    rows = _group_rows(words)

    # --- BLIN + title from the header "<BLIN> / <Title>" (fallback to footer) ---
    blin = title = None
    for r in rows:
        line = " ".join(w["text"] for w in r)
        m = HEADER_CODE_RE.search(line)
        if m and BLIN_RE.match(m.group(1)):
            blin, title = m.group(1), m.group(2).strip()
            break
    if blin is None:
        for r in rows:
            line = " ".join(w["text"] for w in r)
            m = LI_FOOTER_RE.search(line)
            if m:
                blin, title = m.group(1), m.group(2).strip()
                break
    if blin is None or not BLIN_RE.match(blin):
        return None

    # --- locate the FY column x-centres from the Resource Summary header ---
    # The header row reads: ... FY 2024  FY 2025  Base OOC Total  FY 2027 ...
    # Years 2024+ each get a column; the request FY (== fy or fy+0) splits into
    # Base/OOC/Total. We map: request quantity/dollars come from the request-FY
    # "Total" column, prior years from their own year columns.
    fycols = _fy_header_columns(words)
    # Build a clean {fy_int: x_center} for plain year columns and capture the
    # request-year Base/OOC/Total band.
    year_centers = {}
    base_x = ooc_x = total_x = None
    for key, xc in fycols.items():
        if key[0] == "FY":
            year_centers[int(key[1])] = xc
        elif key[0] == "BASE":
            base_x = xc
        elif key[0] == "OOC":
            ooc_x = xc
        elif key[0] == "TOTAL":
            total_x = xc

    # The request FY is the one with a Base/OOC/Total split (fy). The FY26 "Total"
    # column carries the full request; if there's no split (older format), the
    # plain year column is the request column.
    request_total_x = total_x if total_x is not None else year_centers.get(fy)

    # Which fiscal years do we emit? The request FY plus any neighbouring plain
    # year columns the page exposes (these carry actuals/enacted/outyear).
    emit_years = {}  # fy_int -> x_center used for quantity/dollars
    if request_total_x is not None:
        emit_years[fy] = request_total_x
    for y, xc in year_centers.items():
        if y == fy:
            # request year: prefer the Total band centre over the bare "FY 2026"
            emit_years.setdefault(y, request_total_x if request_total_x is not None else xc)
        else:
            emit_years[y] = xc

    if not emit_years:
        return None

    # --- read the labelled Resource Summary rows by geometry ---
    def find_row(label_predicate):
        for r in rows:
            line = " ".join(w["text"] for w in r)
            if label_predicate(line):
                return r
        return None

    def row_numbers(r):
        return [w for w in r if AMOUNT_RE.fullmatch(w["text"]) or w["text"] == "-"]

    qty_row = find_row(lambda s: s.startswith("Procurement Quantity"))
    # Net Procurement (P-1) is the authoritative request dollars (in Millions).
    dol_row = find_row(lambda s: s.startswith("Net Procurement (P-1)"))
    if dol_row is None:
        dol_row = find_row(lambda s: s.startswith("Total Obligation Authority"))
    unit_row = find_row(lambda s: s.startswith("Gross/Weapon System Unit Cost"))

    def val_at(r, x_center):
        if r is None or x_center is None:
            return None
        w = _nearest_value(row_numbers(r), x_center)
        return parse_num(w["text"]) if w is not None else None

    fy_data = []
    for y in sorted(emit_years):
        xc = emit_years[y]
        qty = val_at(qty_row, xc)
        dol_millions = val_at(dol_row, xc)
        unit_thousands = val_at(unit_row, xc)
        # Skip empty out-years (no quantity AND no dollars) — keeps the artifact
        # to fiscal years that actually carry a request/actual.
        if qty is None and dol_millions is None:
            continue
        fy_data.append(
            {
                "fy": y,
                "quantity": qty,
                # Net Procurement is in MILLIONS; loader divides by 1000 -> millions.
                "requestDollarsThousands": None if dol_millions is None else round(dol_millions * 1000, 3),
                # Gross/Weapon System Unit Cost is in THOUSANDS -> express in dollars.
                "unitCostDollars": None if unit_thousands is None else round(unit_thousands * 1000, 3),
            }
        )

    # --- child line items: Secondary Distribution recipients ---------------
    line_items = _parse_secondary_distribution(rows, fy)

    return blin, title, fy_data, line_items


def _parse_secondary_distribution(rows, fy):
    """The 'Secondary Distribution' block lists per-recipient quantity +
    obligation authority for the request FY. Each named recipient row (e.g.
    'ANG Quantity ...' / 'Army Quantity ...') becomes a child line item."""
    items = []
    in_block = False
    sd_cols = {}  # fy_int -> x_center, parsed from the block's own header row
    for r in rows:
        line = " ".join(w["text"] for w in r).strip()
        low = line.lower()
        if low.startswith("secondary distribution"):
            in_block = True
            continue
        if not in_block:
            continue
        if low.startswith("justification") or low.startswith("description"):
            break
        # Header row inside the block: "... FY 2024 FY 2025 Base OOC Total FY 2027 ..."
        years = [w for w in r if re.fullmatch(r"20[0-9]{2}", w["text"])]
        if years and not sd_cols:
            for w in r:
                if re.fullmatch(r"20[0-9]{2}", w["text"]):
                    sd_cols[int(w["text"])] = (w["x0"] + w["x1"]) / 2.0
                elif w["text"] == "Total":
                    sd_cols.setdefault(("TOTAL",), (w["x0"] + w["x1"]) / 2.0)
            continue
        # Recipient rows: "<Recipient> Quantity <nums>" then "Total Obligation
        # Authority <nums>". We pair them by the recipient label preceding Quantity.
        m = re.match(r"^(.*?)\s+Quantity\b", line)
        if m and "total:" not in low:
            recipient = m.group(1).strip()
            if recipient and recipient.lower() not in ("total",):
                nums = [w for w in r if AMOUNT_RE.fullmatch(w["text"]) or w["text"] == "-"]
                # request-FY quantity: nearest to the FY26 Total band if known
                xc = sd_cols.get(("TOTAL",)) or sd_cols.get(fy)
                qty = None
                if xc is not None and nums:
                    w = _nearest_value(nums, xc)
                    qty = parse_num(w["text"]) if w else None
                items.append({"_recipient": recipient, "quantity": qty, "dollars": None})
        elif low.startswith("total obligation authority") and items:
            nums = [w for w in r if AMOUNT_RE.fullmatch(w["text"]) or w["text"] == "-"]
            xc = sd_cols.get(("TOTAL",)) or sd_cols.get(fy)
            if xc is not None and nums:
                w = _nearest_value(nums, xc)
                d = parse_num(w["text"]) if w else None
                # attach to the most recent recipient lacking dollars
                for it in reversed(items):
                    if it["dollars"] is None:
                        # Secondary Distribution dollars are in MILLIONS -> the loader's
                        # procurement-line `dollars` is stored as-is, so express full dollars.
                        it["dollars"] = None if d is None else round(d * 1_000_000, 2)
                        break

    out = []
    for it in items:
        out.append(
            {
                "description": it["_recipient"],
                "fy": fy,
                "quantity": it["quantity"],
                "dollars": it["dollars"],
            }
        )
    return out


def extract(pdf_path, service, fy, source_url):
    import pdfplumber

    # Accumulate per-BLIN: a BLIN's P-40 may span several pages; merge fyData
    # (request page wins) and union line items.
    by_blin = {}
    order = []

    with pdfplumber.open(pdf_path) as pdf:
        for page in pdf.pages:
            text = page.extract_text() or ""
            if not _is_p40_page(text):
                continue
            words = page.extract_words(use_text_flow=False, keep_blank_chars=False)
            parsed = _parse_p40(words, fy)
            if parsed is None:
                continue
            blin, title, fy_data, line_items = parsed

            if blin not in by_blin:
                # Derive budget activity from the appropriation header if present.
                ba = None
                m = re.search(r"\bBA\s*([0-9]{1,2})\b", text)
                if m:
                    ba = f"BA {m.group(1)}"
                by_blin[blin] = {
                    "peCode": blin,
                    "title": title,
                    "budgetActivity": ba,
                    "lineNumber": blin,
                    "programOfRecord": None,
                    "fyData": [],
                    "lineItems": [],
                    "_fy_seen": set(),
                }
                order.append(blin)

            entry = by_blin[blin]
            if not entry["title"] and title:
                entry["title"] = title
            # Merge fyData: first non-empty row per FY wins (the request page is
            # encountered first and carries the canonical figures).
            for row in fy_data:
                if row["fy"] not in entry["_fy_seen"]:
                    entry["fyData"].append(row)
                    entry["_fy_seen"].add(row["fy"])
            # Union line items by (description, fy).
            seen_li = {(li["description"], li["fy"]) for li in entry["lineItems"]}
            for li in line_items:
                key = (li["description"], li["fy"])
                if key not in seen_li and li["description"]:
                    entry["lineItems"].append(li)
                    seen_li.add(key)

    pes = []
    for blin in order:
        e = by_blin[blin]
        e.pop("_fy_seen", None)
        # keep only entries that resolved to a usable title
        pes.append(e)

    return {"service": service, "fy": fy, "sourceUrl": source_url, "pes": pes}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("pdf")
    ap.add_argument("--service", required=True, choices=["ARMY", "NAVY", "AF", "SF", "USMC", "DW", "DARPA"])
    ap.add_argument("--fy", type=int, required=True)
    ap.add_argument("--source-url", default="")
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    result = extract(args.pdf, args.service, args.fy, args.source_url)
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(result, f, indent=2)
    print(f"extracted {len(result['pes'])} procurement line items (BLINs) -> {args.out}", file=sys.stderr)


if __name__ == "__main__":
    main()
