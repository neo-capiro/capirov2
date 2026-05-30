#!/usr/bin/env python3
"""Deterministic R-1 / P-1 table extractor for DoD Comptroller J-books.

Reads a budget exhibit PDF and emits one JSON record per program element /
budget line item found, with the 1-based PDF page number for provenance.

This is the deterministic path mandated by the engineering standard
("Deterministic fallback (pdfplumber / Camelot) for clean tables"). The R-1 and
P-1 master lists are clean tabular exhibits, so pdfplumber alone is sufficient
and costs nothing (no Textract). Pages where this yields no rows but contain
table-like text are reported in `unparsed_pages` so the caller can fall back to
Textract TABLES for just those pages.

Usage:
    python extract_jbook_r1.py <pdf_path> [--doc-type R|P]

Output (stdout): JSON
    {
      "docType": "R",
      "pageCount": 245,
      "rows": [
        {"peCode": "0601102A", "title": "Defense Research Sciences",
         "budgetActivity": "01", "lineNumber": "1", "page": 10}
      ],
      "unparsed_pages": [],
      "stats": {"rows": 952, "pages_with_rows": 76}
    }
"""
import sys
import json
import re

PE_RE = re.compile(r"\b([0-9]{7}[A-Z])\b")
# A leading line number (col 1), then the PE code, then the title, then a 2-digit
# budget activity, then a classification letter (U/etc). Dollars trail.
LINE_RE = re.compile(
    r"^\s*(?P<line>\d+)?\s*(?P<pe>[0-9]{7}[A-Z])\s+(?P<rest>.+?)\s+(?P<ba>\d{2})\s+[A-Z]\b"
)


def extract(pdf_path: str, doc_type: str) -> dict:
    import pdfplumber

    rows = []
    unparsed_pages = []
    pages_with_rows = set()

    with pdfplumber.open(pdf_path) as pdf:
        page_count = len(pdf.pages)
        for idx, page in enumerate(pdf.pages, start=1):
            text = page.extract_text() or ""
            page_had_row = False
            page_has_pe_token = bool(PE_RE.search(text))
            for line in text.splitlines():
                m = LINE_RE.match(line)
                if m:
                    pe = m.group("pe")
                    title = re.sub(r"\s+", " ", m.group("rest")).strip()
                    rows.append(
                        {
                            "peCode": pe,
                            "title": title,
                            "budgetActivity": m.group("ba"),
                            "lineNumber": (m.group("line") or "").strip() or None,
                            "page": idx,
                        }
                    )
                    page_had_row = True
                    pages_with_rows.add(idx)
            # If the page clearly references PE codes but we parsed nothing,
            # flag it for a Textract fallback pass.
            if page_has_pe_token and not page_had_row:
                unparsed_pages.append(idx)

    return {
        "docType": doc_type,
        "pageCount": page_count,
        "rows": rows,
        "unparsed_pages": unparsed_pages,
        "stats": {"rows": len(rows), "pages_with_rows": len(pages_with_rows)},
    }


def main() -> None:
    if len(sys.argv) < 2:
        print(json.dumps({"error": "usage: extract_jbook_r1.py <pdf_path> [--doc-type R|P]"}))
        sys.exit(2)
    pdf_path = sys.argv[1]
    doc_type = "R"
    if "--doc-type" in sys.argv:
        i = sys.argv.index("--doc-type")
        if i + 1 < len(sys.argv):
            doc_type = sys.argv[i + 1].upper()
    try:
        result = extract(pdf_path, doc_type)
    except ModuleNotFoundError:
        print(json.dumps({"error": "pdfplumber_not_installed"}))
        sys.exit(3)
    print(json.dumps(result))


if __name__ == "__main__":
    main()
