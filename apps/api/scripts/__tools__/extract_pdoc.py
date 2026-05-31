#!/usr/bin/env python
"""
Offline DoD P-Doc (Procurement budget justification) extractor — Step 27.

Deterministic pdfplumber extraction — same pattern as the R-2 J-book / committee
tools. Turns a Service procurement book PDF (Aircraft/Missile/Weapons/Other
Procurement, Shipbuilding, etc.) into a JSON artifact consumed by
scripts/parse-pdoc-<service>.ts. NO Firecrawl/LLM in the path — the deterministic
pass is the trustworthy one for procurement quantities + dollars.

Usage:
  python extract_pdoc.py BOOK.pdf --service ARMY --fy 2027 \
      --source-url "https://.../Aircraft_Procurement_Army.pdf" \
      --out ../__data__/pdoc_army_aircraft_fy2027.json

Output schema:
  { "service": "ARMY", "fy": 2027, "sourceUrl": "...",
    "pes": [ { peCode, title, budgetActivity, lineNumber, programOfRecord,
               fyData:[{fy,quantity,requestDollarsThousands,unitCostDollars}],
               lineItems:[{description,fy,quantity,dollars}] } ] }

A procurement section starts at a line whose first token is a valid PE code
(7 digits + service letter). The title follows the code on the same line. The
"Cost" / quantity table that follows yields the parent FY totals; indented
sub-rows become child line items. Heuristic — verify against a golden before a
full run, and refine the table-column heuristics per Service as needed.
"""
import argparse
import json
import re
import sys

PE_RE = re.compile(r"^([0-9]{7}[A-Z][A-Z0-9]*)\s+(.+)$")
AMOUNT_RE = re.compile(r"\(?-?\$?[\d,]+(?:\.\d+)?\)?")


def parse_num(token):
    if token is None:
        return None
    t = str(token).strip()
    if not t:
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


def extract(pdf_path, service, fy, source_url):
    import pdfplumber

    pes = []
    current = None
    with pdfplumber.open(pdf_path) as pdf:
        for page in pdf.pages:
            text = page.extract_text() or ""
            for raw in text.split("\n"):
                line = raw.strip()
                if not line:
                    continue
                m = PE_RE.match(line)
                if m:
                    # New parent PE section.
                    current = {
                        "peCode": m.group(1).upper(),
                        "title": m.group(2).strip(),
                        "budgetActivity": None,
                        "lineNumber": None,
                        "programOfRecord": None,
                        "fyData": [],
                        "lineItems": [],
                    }
                    pes.append(current)
                    continue
                if current is None:
                    continue
                # Within a PE: an indented row with a description + amount is a child
                # line item; a "Total"/"Quantity"/"Cost" row contributes parent FY data.
                amounts = [parse_num(a) for a in AMOUNT_RE.findall(line)]
                amounts = [a for a in amounts if a is not None]
                if not amounts:
                    continue
                desc = re.sub(AMOUNT_RE, " ", line)
                desc = re.sub(r"\s+", " ", desc).strip()
                if re.match(r"(?i)total|quantity|cost", desc):
                    current["fyData"].append(
                        {
                            "fy": fy,
                            "quantity": amounts[0] if len(amounts) >= 2 else None,
                            "requestDollarsThousands": amounts[-1],
                            "unitCostDollars": None,
                        }
                    )
                elif desc:
                    current["lineItems"].append(
                        {
                            "description": desc,
                            "fy": fy,
                            "quantity": amounts[0] if len(amounts) >= 2 else None,
                            "dollars": amounts[-1],
                        }
                    )
    # dedupe parents by peCode (last-wins)
    by_pe = {}
    for pe in pes:
        by_pe[pe["peCode"]] = pe
    return {"service": service, "fy": fy, "sourceUrl": source_url, "pes": list(by_pe.values())}


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
    print(f"extracted {len(result['pes'])} procurement PEs -> {args.out}", file=sys.stderr)


if __name__ == "__main__":
    main()
