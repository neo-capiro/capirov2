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

    # The two trailing money columns (request, authorized) anchored at END of line.
    # Anchoring at the end means embedded numbers in the program name (F-22A, F-35,
    # E-7, SSN-774) are NOT mistaken for dollar columns — the old "split on first
    # money token" logic truncated "F–22A SQUADRONS" to "F–".
    TAIL_AMTS = re.compile(r"\s+(\(?-?[\d,]{2,}\)?)\s+(\(?-?[\d,]{2,}\)?)\s*$")
    TAIL_ONE = re.compile(r"\s+(\(?-?[\d,]{2,}\)?)\s*$")

    rows = []
    with pdfplumber.open(pdf_path) as pdf:
        for page in pdf.pages:
            text = page.extract_text() or ""
            lines = text.split("\n")
            for idx, raw in enumerate(lines):
                line = raw.strip()
                m = ROW_RE.match(line)
                if not m:
                    continue
                pe = m.group(1).upper()
                rest = m.group(2)

                # Pull the trailing amount columns off the END of the line.
                two = TAIL_AMTS.search(rest)
                if two:
                    request = parse_amount(two.group(1))
                    mark = parse_amount(two.group(2))
                    name = rest[: two.start()]
                else:
                    one = TAIL_ONE.search(rest)
                    if not one:
                        continue
                    request, mark = None, parse_amount(one.group(1))
                    name = rest[: one.start()]

                if request is None and mark is None:
                    continue
                # NDAA funding tables are "In Thousands of Dollars" -> scale to dollars.
                if request is not None:
                    request *= 1000
                if mark is not None:
                    mark *= 1000

                # Clean the name: strip dot-leaders / trailing punctuation.
                name = re.sub(r"[.\s]+$", "", name).strip(" .")
                # De-hyphenate a wrapped program name: when the name ends with a
                # hyphen the final word continued on the NEXT physical line(s) (e.g.
                # "...ADVANCED TECH-" + "NOLOGY." or "...TRAINING AD-" + "VANCED
                # TECHNOLOGY."). The continuation runs up to the first period. Splice
                # it in. Guard against swallowing a following PE row or a bracketed
                # plus-up annotation line.
                if name.endswith("-") and idx + 1 < len(lines):
                    cont = lines[idx + 1].strip()
                    if cont and not ROW_RE.match(cont) and not cont.lstrip().startswith("["):
                        # Continuation is the text up to the first period (sentence end
                        # of the program name). May be multiple words ("VANCED TECHNOLOGY").
                        frag = cont.split(".", 1)[0].strip()
                        # Strip any trailing bracketed plus-up that shares the line.
                        frag = re.split(r"\s*\[", frag, 1)[0].strip()
                        if frag and not MONEY_RE.fullmatch(frag.replace(" ", "")):
                            first, _, rest_words = frag.partition(" ")
                            # The hyphen joins the FIRST continuation token directly
                            # (TECH- + NOLOGY); any further words append with a space.
                            name = name[:-1] + first + ((" " + rest_words) if rest_words else "")
                name = name or None

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
