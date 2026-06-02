#!/usr/bin/env python
"""
HASC/SASC NDAA *bill* funding-table extractor (FY27, H.R.8800 / S.2296 format).

The committed extract_armed_services_report.py anchors the PE code at line START
(^PEcode). But the NDAA bill funding tables (Division D, "SEC. 4x01 RESEARCH,
DEVELOPMENT, TEST, AND EVALUATION") format each row as:

    001 0601102F DEFENSE RESEARCH SCIENCES.......... 296,535 296,535
    <line#>  <PEcode>  <program name + dot leaders>  <FY request>  <authorized/mark>

So the PE code is the SECOND token (after a line number), and there are exactly
two trailing amounts: request and the chamber's authorized amount (= the mark).
Bracketed sub-lines ("Project X [10,000]") are plus-up annotations, skipped.

Usage:
  python extract_ndaa_funding_tables.py REPORT.pdf --chamber HASC --fy 2027 \
      --out ../__data__/armed_services_hasc_fy2027.json
"""
import argparse
import json
import re

# PE code may be first token OR preceded by a 1-4 digit line number.
ROW_RE = re.compile(r"^(?:\d{1,4}\s+)?([0-9]{7}[A-Z][A-Z0-9]?)\b(.*)$")
# A trailing money column: 1,234 or 12,345 or (500) negative. Not bracketed plus-ups.
MONEY_RE = re.compile(r"(?<![\[\d])\(?-?[\d,]{2,}\)?(?!\s*\])")


def parse_amount(tok):
    if tok is None:
        return None
    t = str(tok).strip()
    neg = t.startswith("(") and t.endswith(")")
    cleaned = re.sub(r"[(),$\s]", "", t)
    if cleaned in ("", "-"):
        return None
    try:
        n = int(cleaned)
    except ValueError:
        return None
    return -n if neg else n


def extract_rows(pdf_path, fy):
    import pdfplumber

    rows = []
    with pdfplumber.open(pdf_path) as pdf:
        for page in pdf.pages:
            text = page.extract_text() or ""
            for raw in text.split("\n"):
                line = raw.strip()
                m = ROW_RE.match(line)
                if not m:
                    continue
                pe = m.group(1).upper()
                rest = m.group(2)
                # Take the last two money tokens on the line: [request, mark].
                amts = [parse_amount(a) for a in MONEY_RE.findall(rest)]
                amts = [a for a in amts if a is not None]
                if not amts:
                    continue
                if len(amts) >= 2:
                    request, mark = amts[-2], amts[-1]
                else:
                    request, mark = None, amts[-1]
                # NDAA funding tables are printed "In Thousands of Dollars"; the
                # canonical program_element_year store is in DOLLARS. Scale up.
                if request is not None:
                    request *= 1000
                if mark is not None:
                    mark *= 1000
                # program name = text before the first money token
                name = MONEY_RE.split(rest)[0]
                name = re.sub(r"[.\s]+$", "", name).strip(" .") or None
                rows.append(
                    {"peCode": pe, "fy": fy, "request": request, "mark": mark, "explanation": name}
                )
    by_pe = {}
    for r in rows:
        by_pe[r["peCode"]] = r  # last-wins dedupe
    return list(by_pe.values())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("pdf")
    ap.add_argument("--chamber", required=True, choices=["HASC", "SASC"])
    ap.add_argument("--fy", type=int, required=True)
    ap.add_argument("--out", required=True)
    a = ap.parse_args()
    rows = extract_rows(a.pdf, a.fy)
    out = {"chamber": a.chamber, "fy": a.fy, "source": a.pdf, "rows": rows}
    with open(a.out, "w", encoding="utf-8") as f:
        json.dump(out, f, indent=2)
    print(f"extracted {len(rows)} PE rows -> {a.out}")
    # sample for eyeballing
    for r in rows[:5]:
        print(" ", r["peCode"], "req=", r["request"], "mark=", r["mark"], "|", (r["explanation"] or "")[:40])


if __name__ == "__main__":
    main()
