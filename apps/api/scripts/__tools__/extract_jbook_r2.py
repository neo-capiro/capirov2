#!/usr/bin/env python3
"""Deterministic R-2 / R-2A descriptive-summary extractor for DoD Comptroller
Service RDT&E Justification Books (e.g. Army "RDTE - Vol N - Budget Activity X").

Unlike the R-1 master list (a flat table), an R-2 volume contains one multi-page
*descriptive summary* per Program Element:

    Exhibit R-2,  RDT&E Budget Item Justification   <- PE-level narrative + funding
      Appropriation/Budget Activity  |  PE <code> / <name>
      COST table (Total PE + per-project rows across FY columns)
      A. Mission Description and Budget Item Justification  <- the narrative we want
    Exhibit R-2A, RDT&E Project Justification        <- project-level (AA1, AA2, ...)
      ... PE <code> / <name>   |   <projectCode> / <projectName>
      A. Mission Description ...                        <- project narrative

This is the deterministic path mandated by the engineering standard. pdfplumber
text extraction is sufficient (these exhibits are clean text, not scanned), so it
costs nothing (no Textract).

For each PE we emit:
  - peCode, peName, budgetActivity, appropriation
  - pageStart / pageEnd  (1-based) of the PE's contiguous exhibit block -> citations
  - mission   (the R-2 "A. Mission Description ..." narrative text)
  - projects  [{projectCode, title, mission, page}]   from R-2A exhibits

Usage:
    python extract_jbook_r2.py <pdf_path> --fy 2027 --source-url <url> [--volume-id <id>]

Output (stdout): JSON
    {
      "docType": "R", "exhibitType": "R-2", "fy": 2027,
      "sourceUrl": "...", "volumeId": "vol1_ba1",
      "pageCount": 153,
      "programElements": [
        {"peCode":"0601102A","peName":"Defense Research Sciences",
         "budgetActivity":"01","appropriation":"2040",
         "pageStart":33,"pageEnd":40,
         "mission":"This Program Element (PE) builds ...",
         "projects":[{"projectCode":"AA2","title":"ILIR - SMDC","mission":"...","page":41}]}
      ],
      "stats": {"program_elements": 7, "projects": 19, "pages_with_exhibits": 122}
    }
"""
import sys
import json
import re

# A PE code can be the canonical 7-digit + service letter, optionally followed by
# a Defense-Wide / Space Force suffix (kept in sync with isValidPeCode on the TS
# side). The header form is always "PE <code> / <name>".
PE_HEADER_RE = re.compile(
    r"PE\s+(?P<pe>[0-9]{7}[A-Z][A-Z0-9]*)\s*/\s*(?P<name>.+?)\s*$"
)
# R-2A project header: "... PE <code> / <name> <projectCode> / <projectName>"
# projectCode is a 3-char alphanumeric token (AA2, T14, CL3, J13, DC4, BS6, ...).
PROJECT_HEADER_RE = re.compile(
    r"PE\s+[0-9]{7}[A-Z][A-Z0-9]*\s*/\s*.+?\s+(?P<proj>[A-Z0-9]{2,4})\s*/\s*(?P<pname>.+?)\s*$"
)
APPROP_BA_RE = re.compile(r"^\s*(?P<approp>\d{3,4})\s*/\s*(?P<ba>\d+)\b")
EXHIBIT_R2_RE = re.compile(r"Exhibit\s+R-2\b(?!A)")   # R-2 but not R-2A
EXHIBIT_R2A_RE = re.compile(r"Exhibit\s+R-2A\b")
MISSION_HDR_RE = re.compile(r"A\.\s+Mission Description and Budget Item Justification")
# Section headers that terminate the mission narrative.
MISSION_END_RE = re.compile(
    r"^\s*(B\.\s|C\.\s|Accomplishments/Planned|FY\s+20\d\d\s+Plans|"
    r"Title:|Exhibit\s+R-|UNCLASSIFIED\s*$)"
)
NOISE_RE = re.compile(r"^\s*(UNCLASSIFIED|Page\s+\d+\s+of\s+\d+)\s*$", re.IGNORECASE)


def _clean(s: str) -> str:
    return re.sub(r"\s+", " ", s or "").strip()


def _grab_mission(lines, start_idx):
    """Collect the mission narrative starting just after the 'A. Mission ...' header
    line at lines[start_idx], stopping at the next section/exhibit boundary."""
    out = []
    for ln in lines[start_idx + 1:]:
        if MISSION_END_RE.match(ln):
            break
        if NOISE_RE.match(ln):
            continue
        out.append(ln.strip())
    return _clean(" ".join(out))


def extract(pdf_path: str, fy: int, source_url: str, volume_id: str, budget_activity: str = None) -> dict:
    import pdfplumber

    # pe_code -> aggregate record
    pes = {}
    projects_count = 0
    pages_with_exhibits = 0

    with pdfplumber.open(pdf_path) as pdf:
        page_count = len(pdf.pages)
        for idx, page in enumerate(pdf.pages, start=1):
            text = page.extract_text() or ""
            if not text:
                continue
            is_r2a = bool(EXHIBIT_R2A_RE.search(text))
            is_r2 = bool(EXHIBIT_R2_RE.search(text)) and not is_r2a
            if not (is_r2 or is_r2a):
                continue
            pages_with_exhibits += 1
            lines = text.splitlines()

            if is_r2a:
                # Project-level exhibit. Find the header line carrying PE + project.
                ph = None
                pe_for_proj = None
                for ln in lines:
                    m = PE_HEADER_RE.search(ln)
                    if m:
                        pe_for_proj = m.group("pe")
                    mp = PROJECT_HEADER_RE.search(ln)
                    if mp:
                        ph = mp
                        # capture PE from same line too if present
                        mpe = re.search(r"PE\s+([0-9]{7}[A-Z][A-Z0-9]*)", ln)
                        if mpe:
                            pe_for_proj = mpe.group(1)
                        break
                if ph and pe_for_proj:
                    rec = pes.setdefault(pe_for_proj, _blank_pe(pe_for_proj))
                    mission = ""
                    for i, ln in enumerate(lines):
                        if MISSION_HDR_RE.search(ln):
                            mission = _grab_mission(lines, i)
                            break
                    proj_code = ph.group("proj")
                    if not any(p["projectCode"] == proj_code for p in rec["projects"]):
                        rec["projects"].append(
                            {
                                "projectCode": proj_code,
                                "title": _clean(ph.group("pname")),
                                "mission": mission,
                                "page": idx,
                            }
                        )
                        projects_count += 1
                    rec["pageEnd"] = max(rec["pageEnd"] or idx, idx)
                continue

            # PE-level R-2 exhibit.
            pe_code = None
            pe_name = None
            approp = None
            ba = None
            for i, ln in enumerate(lines):
                m = PE_HEADER_RE.search(ln)
                if m and pe_code is None:
                    pe_code = m.group("pe")
                    pe_name = _clean(m.group("name"))
                ab = APPROP_BA_RE.match(ln)
                if ab and approp is None:
                    approp = ab.group("approp")
                    ba = ab.group("ba")
            if not pe_code:
                continue
            rec = pes.setdefault(pe_code, _blank_pe(pe_code))
            if pe_name and not rec["peName"]:
                rec["peName"] = pe_name
            if approp and not rec["appropriation"]:
                rec["appropriation"] = approp
            if ba and not rec["budgetActivity"]:
                rec["budgetActivity"] = ba.zfill(2)
            elif budget_activity and not rec["budgetActivity"]:
                rec["budgetActivity"] = budget_activity
            # mission narrative (only on the page that carries the header)
            if not rec["mission"]:
                for i, ln in enumerate(lines):
                    if MISSION_HDR_RE.search(ln):
                        rec["mission"] = _grab_mission(lines, i)
                        break
            rec["pageStart"] = rec["pageStart"] if rec["pageStart"] else idx
            rec["pageStart"] = min(rec["pageStart"], idx)
            rec["pageEnd"] = max(rec["pageEnd"] or idx, idx)

    program_elements = [pes[k] for k in sorted(pes)]
    # Backfill budget activity from the volume (deterministic; the per-volume BA is
    # known from the source config) for any PE the header parse missed.
    if budget_activity:
        for pe in program_elements:
            if not pe["budgetActivity"]:
                pe["budgetActivity"] = budget_activity
    return {
        "docType": "R",
        "exhibitType": "R-2",
        "fy": fy,
        "sourceUrl": source_url,
        "volumeId": volume_id,
        "pageCount": page_count,
        "programElements": program_elements,
        "stats": {
            "program_elements": len(program_elements),
            "projects": projects_count,
            "pages_with_exhibits": pages_with_exhibits,
        },
    }


def _blank_pe(pe_code: str) -> dict:
    return {
        "peCode": pe_code,
        "peName": "",
        "budgetActivity": None,
        "appropriation": None,
        "pageStart": None,
        "pageEnd": None,
        "mission": "",
        "projects": [],
    }


def _arg(flag, default=None):
    if flag in sys.argv:
        i = sys.argv.index(flag)
        if i + 1 < len(sys.argv):
            return sys.argv[i + 1]
    return default


def main() -> None:
    if len(sys.argv) < 2:
        print(json.dumps({"error": "usage: extract_jbook_r2.py <pdf_path> --fy 2027 --source-url <url> [--volume-id <id>]"}))
        sys.exit(2)
    pdf_path = sys.argv[1]
    fy = int(_arg("--fy", "2027"))
    source_url = _arg("--source-url", "")
    volume_id = _arg("--volume-id", "")
    budget_activity = _arg("--budget-activity", None)
    try:
        result = extract(pdf_path, fy, source_url, volume_id, budget_activity)
    except ModuleNotFoundError:
        print(json.dumps({"error": "pdfplumber_not_installed"}))
        sys.exit(3)
    print(json.dumps(result))


if __name__ == "__main__":
    main()
