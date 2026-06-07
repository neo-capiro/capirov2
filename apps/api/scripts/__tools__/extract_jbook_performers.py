#!/usr/bin/env python3
"""Deterministic R-3 / R-2A performer (prime contractor) extractor for DoD RDT&E
Justification Books. Companion to extract_jbook_r2.py.

These J-books contain, per Program Element, "Product Development", "Support",
and "Management Services" cost tables (Exhibit R-3 / embedded in R-2A) that NAME
the performing activity (prime contractor) with contract method/type, location,
and total cost. This is the zero-inference, government-stated PE -> prime-contractor
link. Our R-2 extractor only captured PE narrative + project list and DROPPED these
performer tables; this tool recovers them.

Approach: coordinate-based column slicing (pdfplumber word boxes). Plain text
extraction interleaves the multi-line wrapped cells unusably; word X-bands are stable.

Per page (an R-3 cost-analysis page), we:
  1. read the PE code from the header (PE <code> / <name>),
  2. locate columns from the table header words: 'Method' (contract method/type),
     'Performing'(activity & location), 'Prior' (numeric block left edge),
  3. accumulate performer entries: a company name (possibly wrapped over lines)
     terminated by a ' : <location>' line; contract method from the method column;
     total cost = the entry's TotalCost numeric.

Output JSON:
  {"docType":"R","exhibitType":"R-3","fy":2027,"sourceUrl":..,"volumeId":..,
   "publisher":"DoD Comptroller (Navy)","pageCount":N,
   "performers":[{"peCode","peName","projectCode","projectName","costCategory",
                  "performer","performerNormalized","location","contractMethod",
                  "totalCost","fy","page"}],
   "stats":{...}}

Usage:
  python extract_jbook_performers.py <pdf> --fy 2027 --source-url <url> \
      --volume-id <id> --publisher "DoD Comptroller (Navy)" [--out <path>]
"""
import sys, os, json, re

PE_HEADER_RE = re.compile(r"PE\s+(?P<pe>[0-9]{7}[A-Z][A-Z0-9]*)\s*/\s*(?P<name>.+?)\s*$")
# Project on the R-3 header line: "... <projCode> / <projName>" after the PE
PROJ_RE = re.compile(r"PE\s+[0-9]{7}[A-Z][A-Z0-9]*\s*/\s*.+?\s+(?P<proj>[A-Z0-9]{2,5})\s*/\s*(?P<pname>.+?)\s*$")
NUM_RE = re.compile(r"^-?\d[\d,]*\.\d{3}$")
HDR_WORDS = {"Activity","Location","Performing","&","Cost","Category","Item","Contract",
             "Method","Type","Prior","Years","Award","Date","Complete","To","Total",
             "Target","Value","of","FY","Base","OOC","Sample","Subtotal","Remarks"}
# Contract-method vocabulary (validation when method column is ambiguous)
METHOD_TOKEN_RE = re.compile(
    r"^(SS|C|WX|MIPR|TBD|N/A|NA|RC|UCA|Allot(ment)?|Option|Grant|Various|"
    r"FFP|CPFF|CPAF|CPIF|FPIF|FPAF|FPLOE|IDIQ|FP|T&M|BOA|CR)\b", re.IGNORECASE)
# Table that names performers
TABLE_HDR_RE = re.compile(r"(Product Development|Support \(|Management Services|Test and Evaluation|Operations)", re.IGNORECASE)
NOISE_LOC = re.compile(r"^(Various|TBD|N/A|Multiple)", re.IGNORECASE)

LEGAL_SUFFIX = re.compile(r"\b(INC|INCORPORATED|CORP|CORPORATION|CO|COMPANY|LLC|L\.?L\.?C|LTD|LP|"
                          r"L\.?P|PLC|TECHNOLOGIES|TECHNOLOGY|SYSTEMS|GROUP|SVCS|SERVICES|"
                          r"INTERNATIONAL|INTL|ASSOCIATES|CONSULTING|SOLUTIONS|"
                          r"LABORATORIES|LABORATORY|LABS)\b", re.IGNORECASE)

US_STATE_CODES = {
 "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA","KS","KY",
 "LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND",
 "OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY","DC"}

def _strip_leading_location(company: str) -> str:
    """A trailing location token from the row above sometimes bleeds into the front of
    a company name ('VARIOUS LOCKHEED MARTIN', 'DAHLGREN VA LOCKHEED MARTIN', 'CA LOCKHEED
    MARTIN'). Strip a leading 'Various', a leading 2-letter state code, or a 'City ST'
    prefix when more real company tokens follow."""
    toks = company.split()
    if not toks:
        return company
    changed = True
    while changed and len(toks) > 1:
        changed = False
        # leading 'Various'
        if toks[0].upper() == "VARIOUS":
            toks = toks[1:]; changed = True; continue
        # leading bare state code
        if toks[0].upper() in US_STATE_CODES:
            toks = toks[1:]; changed = True; continue
        # leading 'City ST' (e.g. 'DAHLGREN VA', 'HUENEME CA') -> drop the state, then the city
        if len(toks) >= 2 and toks[1].upper() in US_STATE_CODES:
            toks = toks[2:]; changed = True; continue
        # leading 'MDA' (govt) prefix bleed
        if toks[0].upper() == "MDA" and len(toks) > 1 and toks[1][0].isupper():
            toks = toks[1:]; changed = True; continue
    return " ".join(toks).strip()

def normalize_performer(name: str) -> str:
    n = _strip_leading_location(re.sub(r"\s+", " ", (name or "")).strip())
    n = n.strip().upper()
    n = n.strip(" .,-")
    n = re.sub(r"[.,]", "", n)
    # collapse common legal-form variants
    n = n.replace("CORPORATION", "CORP").replace("INCORPORATED", "INC")
    n = re.sub(r"\bL L C\b", "LLC", n)
    # strip a single trailing legal suffix so 'LOCKHEED MARTIN' == 'LOCKHEED MARTIN CORP'
    n = re.sub(r"\s+(CORP|INC|CO|LLC|LTD|LP|PLC)$", "", n).strip()
    return n

def _money_to_float(s):
    if not s: return None
    try: return float(s.replace(",", ""))
    except Exception: return None

def _clean_display_performer(name: str) -> str:
    """Strip a leading location prefix that bled in from the row above, preserving the
    original casing for UI display (e.g. 'Denver, CO Raytheon' -> 'Raytheon')."""
    cleaned = _strip_leading_location(re.sub(r"\s+", " ", (name or "")).strip())
    return cleaned.strip(" .,-") or (name or "").strip()

def extract(pdf_path, fy, source_url, volume_id, publisher):
    import fitz  # PyMuPDF — fast text pre-scan AND word extraction (≈20x faster than pdfplumber)
    performers = []
    pages_with_perf = 0

    fdoc = fitz.open(pdf_path)
    page_count = fdoc.page_count
    for i in range(page_count):
        page = fdoc[i]
        text = page.get_text()
        if not (("Product Development" in text or "Management Services" in text or "Support (" in text)
                and "Performing" in text and "Prior" in text):
            continue
        idx = i + 1  # 1-based page number
        # fitz words: (x0, y0, x1, y1, "word", block, line, wordno) -> map to dicts like pdfplumber
        raw = page.get_text("words")
        words = [{"x0": w[0], "top": w[1], "x1": w[2], "bottom": w[3], "text": w[4]} for w in raw]
        if not words:
            continue
        # PE + project from header
        pe_code = pe_name = proj_code = proj_name = None
        for ln in text.splitlines():
            mp = PROJ_RE.search(ln)
            if mp and not proj_code:
                proj_code = mp.group("proj"); proj_name = re.sub(r"\s+"," ",mp.group("pname")).strip()
            m = PE_HEADER_RE.search(ln)
            if m and not pe_code:
                pe_code = m.group("pe"); pe_name = re.sub(r"\s+"," ",m.group("name")).strip()
        if not pe_code:
            continue
        rows = _extract_rows_from_words(words)
        if rows:
            pages_with_perf += 1
        for r in rows:
            performers.append({
                "peCode": pe_code, "peName": pe_name,
                "projectCode": proj_code, "projectName": proj_name,
                "costCategory": r.get("costCategory"),
                "performer": _clean_display_performer(r["performer"]),
                "performerNormalized": normalize_performer(r["performer"]),
                "location": r["location"],
                "contractMethod": r["contractMethod"],
                "totalCost": _money_to_float(r["totalCost"]),
                "fy": fy, "page": idx,
            })
    fdoc.close()
    # dedupe identical (peCode, performerNormalized, location, contractMethod, costCategory)
    seen = set(); deduped = []
    for p in performers:
        k = (p["peCode"], p["performerNormalized"], p["location"], p["contractMethod"], p.get("costCategory"))
        if k in seen: continue
        seen.add(k); deduped.append(p)
    distinct_pes = sorted({p["peCode"] for p in deduped})
    return {
        "docType": "R", "exhibitType": "R-3", "fy": fy,
        "sourceUrl": source_url, "volumeId": volume_id, "publisher": publisher,
        "pageCount": page_count,
        "performers": deduped,
        "stats": {
            "performer_rows": len(deduped),
            "distinct_pes": len(distinct_pes),
            "pages_with_performers": pages_with_perf,
            "named_company_rows": sum(1 for p in deduped if not NOISE_LOC.match(p["performer"]) and bool(LEGAL_SUFFIX.search(p["performer"]) or len(p["performer"])>4)),
        },
    }

def _extract_rows_from_words(words):
    perf_hdr=[w for w in words if w["text"]=="Performing"]
    prior_hdr=[w for w in words if w["text"]=="Prior"]
    method_hdr=[w for w in words if w["text"]=="Method"]
    if not (perf_hdr and prior_hdr):
        return []
    method_x = min(w["x0"] for w in method_hdr) if method_hdr else 120.0
    prior_x  = min(w["x0"] for w in prior_hdr)
    band=[w for w in words if method_x+20 <= w["x0"] < prior_x-2]
    if not band:
        return []
    from collections import Counter
    left_edge=Counter(round(w["x0"]) for w in band).most_common(1)[0][0]
    PERF_L=left_edge-3; PERF_R=prior_x-3
    METH_L=method_x-3; METH_R=PERF_L
    hdr_bottom=max(w["bottom"] for w in (perf_hdr+prior_hdr))
    data=[w for w in words if w["top"]>hdr_bottom+1]
    data.sort(key=lambda w:(round(w["top"],1), w["x0"]))
    rowmap=[]; cy=None; cur=[]
    for w in data:
        if cy is None or abs(w["top"]-cy)<=3.2:
            cur.append(w); cy=w["top"] if cy is None else cy
        else:
            rowmap.append((cy,cur)); cur=[w]; cy=w["top"]
    if cur: rowmap.append((cy,cur))
    rows=[]; frag=[]; cat_frag=[]; pending_method=None; pending_nums=[]
    # Precompute per-row column slices so we can look ahead for a wrapped location line.
    parsed=[]
    for top,wl in rowmap:
        ws=sorted(wl,key=lambda x:x["x0"])
        perf_toks=[w["text"] for w in ws if PERF_L<=w["x0"]<PERF_R and not NUM_RE.match(w["text"]) and w["text"] not in HDR_WORDS]
        meth_txt=" ".join(w["text"] for w in ws if METH_L<=w["x0"]<METH_R and w["text"] not in HDR_WORDS)
        cat_txt=" ".join(w["text"] for w in ws if w["x0"]<METH_L and w["text"] not in HDR_WORDS and not NUM_RE.match(w["text"]))
        nums=[w["text"] for w in ws if w["x0"]>=prior_x-3 and NUM_RE.match(w["text"])]
        parsed.append({"perf":" ".join(perf_toks),"meth":meth_txt.strip(),"cat":cat_txt.strip(),"nums":nums})

    LOC_ONLY_RE=re.compile(r"^[A-Za-z][\w .,'\-/&]*$")
    for j,p in enumerate(parsed):
        perf_txt=p["perf"]; meth_txt=p["meth"]; cat_txt=p["cat"]; nums=p["nums"]
        if nums: pending_nums.extend(nums)
        if cat_txt: cat_frag.append(cat_txt)
        if ":" in perf_txt:
            company_part,_,loc=perf_txt.partition(":")
            full_company=re.sub(r"\s+"," "," ".join(frag+[company_part]).strip())
            loc=loc.strip()
            # Navy/Army layout: the location often wraps onto the NEXT perf line (no colon,
            # no method, no numbers). If our colon-line had no/short location, borrow it.
            if (not loc) and j+1 < len(parsed):
                nxt=parsed[j+1]
                if (":" not in nxt["perf"]) and (not nxt["meth"]) and (not nxt["nums"]) and nxt["perf"] and LOC_ONLY_RE.match(nxt["perf"]):
                    loc=nxt["perf"].strip()
                    nxt["perf"]=""  # consume so it isn't mistaken for the next company
            tc=pending_nums[-2] if len(pending_nums)>=2 else (pending_nums[-1] if pending_nums else None)
            cat=re.sub(r"\s+"," "," ".join(cat_frag)).strip() or None
            if re.search(r"[A-Za-z]{2,}",full_company):
                rows.append({"performer":full_company.strip(),"location":loc.strip(),
                             "contractMethod":(meth_txt or pending_method or "").strip() or None,
                             "totalCost":tc,"costCategory":cat[:120] if cat else None})
            frag=[]; cat_frag=[]; pending_method=None; pending_nums=[]
        else:
            if perf_txt.strip():
                frag.append(perf_txt.strip())
                if len(frag)>5: frag=frag[-5:]
            if meth_txt:
                pending_method=meth_txt
    return rows

def _arg(flag, default=None):
    if flag in sys.argv:
        i=sys.argv.index(flag)
        if i+1<len(sys.argv): return sys.argv[i+1]
    return default

def main():
    if len(sys.argv)<2:
        print(json.dumps({"error":"usage: extract_jbook_performers.py <pdf> --fy 2027 --source-url <url> --volume-id <id> --publisher <p> [--out <path>]"})); sys.exit(2)
    pdf_path=sys.argv[1]
    fy=int(_arg("--fy","2027")); url=_arg("--source-url",""); vol=_arg("--volume-id","")
    publisher=_arg("--publisher","DoD Comptroller")
    out=_arg("--out")
    try:
        res=extract(pdf_path,fy,url,vol,publisher)
    except ModuleNotFoundError:
        print(json.dumps({"error":"pdfplumber_not_installed"})); sys.exit(3)
    payload=json.dumps(res)
    if out:
        with open(out,"w",encoding="utf-8") as f: f.write(payload)
        print(json.dumps({"wrote":out, **res["stats"]}))
    else:
        print(payload)

if __name__=="__main__":
    main()
