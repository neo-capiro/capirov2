#!/usr/bin/env python
"""
Offline HASC / SASC committee-report PE-mark extractor (Step 22).

Deterministic pdfplumber extraction — same pattern as the R-1/R-2 J-book tools.
Turns a House (HRPT) or Senate (SRPT) Armed Services NDAA report PDF into a JSON
rows artifact consumed by scripts/parse-hasc-sasc-reports.ts (which loads them via
the program-element writer). NO Textract / LLM in the runtime path.

Usage:
  python extract_armed_services_report.py REPORT.pdf --chamber HASC --fy 2027 \
      --out ../__data__/armed_services_hasc_fy2027.json

Output schema:
  { "chamber": "HASC", "fy": 2027, "source": "report.pdf",
    "rows": [ {"peCode","fy","request","mark","explanation"} ... ] }

Each row is a table line whose first column is a valid PE code (7 digits + letter).
The LAST money column on the line is the committee mark; when two are present the
first is the President's request. Amounts kept as printed (typically thousands).
"""
import argparse
import json
import re
import sys

PE_RE = re.compile(r"^([0-9]{7}[A-Z][A-Z0-9]*)\b")
AMOUNT_RE = re.compile(r"\(?-?\$?[\d,]+(?:\.\d+)?\)?")


def parse_amount(token):
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


def extract_rows(pdf_path, fy):
    import pdfplumber

    rows = []
    with pdfplumber.open(pdf_path) as pdf:
        for page in pdf.pages:
            text = page.extract_text() or ""
            for raw in text.split("\n"):
                line = raw.strip()
                m = PE_RE.match(line)
                if not m:
                    continue
                pe = m.group(1).upper()
                after = line[len(m.group(1)):]
                amounts = [parse_amount(a) for a in AMOUNT_RE.findall(after)]
                amounts = [a for a in amounts if a is not None]
                if not amounts:
                    continue
                mark = amounts[-1]
                request = amounts[0] if len(amounts) >= 2 else None
                explanation = re.sub(AMOUNT_RE, " ", after)
                explanation = re.sub(r"\s+", " ", explanation).strip() or None
                rows.append(
                    {"peCode": pe, "fy": fy, "request": request, "mark": mark, "explanation": explanation}
                )
    # last-wins dedupe on peCode
    by_pe = {}
    for r in rows:
        by_pe[r["peCode"]] = r
    return list(by_pe.values())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("pdf")
    ap.add_argument("--chamber", required=True, choices=["HASC", "SASC"])
    ap.add_argument("--fy", type=int, required=True)
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    rows = extract_rows(args.pdf, args.fy)
    out = {"chamber": args.chamber, "fy": args.fy, "source": args.pdf, "rows": rows}
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(out, f, indent=2)
    print(f"extracted {len(rows)} PE rows -> {args.out}", file=sys.stderr)


if __name__ == "__main__":
    main()
