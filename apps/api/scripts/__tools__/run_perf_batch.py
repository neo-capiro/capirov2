#!/usr/bin/env python3
"""Batch-run extract_jbook_performers over all local RDT&E justification books and
write committed artifacts to apps/api/scripts/__data__/jbook_performers_<volumeId>.json.

Maps each local PDF -> (sourceUrl, publisher, volumeId, fy). Source URLs mirror the
existing jbook_r2_*.json sourceUrl values so provenance deep-links stay consistent."""
import os, sys, subprocess, json, re

SRC = r"C:/Users/neoma/Downloads/New folder (2)"
TOOL = os.path.join(os.path.dirname(__file__), "extract_jbook_performers.py")
OUTDIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "__data__"))
FY = "2027"

# filename -> (volumeId, publisher, sourceUrl)
NAVY = "https://www.secnav.navy.mil/fmc/{}"
AF = "https://www.af.mil/saffm/{}"
ARMY = "https://www.asafm.army.mil/Portals/72/Documents/BudgetMaterial/2027/Discretionary Budget/rdte/{}"

BOOKS = {
  # Navy
  "RDTEN_BA1-3_Book.pdf":  ("navy_ba1_3", "DoD Comptroller (Navy)", NAVY.format("RDTEN_BA1-3_Book.pdf")),
  "RDTEN_BA4_Book.pdf":    ("navy_ba4",   "DoD Comptroller (Navy)", NAVY.format("RDTEN_BA4_Book.pdf")),
  "RDTEN_BA5_Book.pdf":    ("navy_ba5",   "DoD Comptroller (Navy)", NAVY.format("RDTEN_BA5_Book.pdf")),
  "RDTEN_BA6_Book.pdf":    ("navy_ba6",   "DoD Comptroller (Navy)", NAVY.format("RDTEN_BA6_Book.pdf")),
  "RDTEN_BA7-8_Book.pdf":  ("navy_ba7_8", "DoD Comptroller (Navy)", NAVY.format("RDTEN_BA7-8_Book.pdf")),
  # Army (dedupe: use the non-"(1)" copies)
  "RDTE - Vol 1 - Budget Activity 1.pdf":  ("army_vol1_ba1","DoD Comptroller (Army)", ARMY.format("RDTE - Vol 1 - Budget Activity 1.pdf")),
  "RDTE - Vol 1 - Budget Activity 2.pdf":  ("army_vol1_ba2","DoD Comptroller (Army)", ARMY.format("RDTE - Vol 1 - Budget Activity 2.pdf")),
  "RDTE - Vol 2 - Budget Activity 4A.pdf": ("army_vol2_ba4a","DoD Comptroller (Army)", ARMY.format("RDTE - Vol 2 - Budget Activity 4A.pdf")),
  "RDTE - Vol 2 - Budget Activity 4B.pdf": ("army_vol2_ba4b","DoD Comptroller (Army)", ARMY.format("RDTE - Vol 2 - Budget Activity 4B.pdf")),
  "RDTE - Vol 3 - Budget Activity 5B.pdf": ("army_vol3_ba5b","DoD Comptroller (Army)", ARMY.format("RDTE - Vol 3 - Budget Activity 5B.pdf")),
  "RDTEVol3BudgetActivity5C.pdf":          ("army_vol3_ba5c","DoD Comptroller (Army)", ARMY.format("RDTE - Vol 3 - Budget Activity 5C.pdf")),
  "RDTE - Vol 3 - Budget Activity 5D.pdf": ("army_vol3_ba5d","DoD Comptroller (Army)", ARMY.format("RDTE - Vol 3 - Budget Activity 5D.pdf")),
  "RDTE - Vol 4 - Budget Activity 6.pdf":  ("army_vol4_ba6","DoD Comptroller (Army)", ARMY.format("RDTE - Vol 4 - Budget Activity 6.pdf")),
  "RDTE - Vol 4 - Budget Activity 7.pdf":  ("army_vol4_ba7","DoD Comptroller (Army)", ARMY.format("RDTE - Vol 4 - Budget Activity 7.pdf")),
  "RDTE - Vol 4 - Budget Activity 8.pdf":  ("army_vol4_ba8","DoD Comptroller (Army)", ARMY.format("RDTE - Vol 4 - Budget Activity 8.pdf")),
  # Air Force
  "FY27 Air Force Research, Development, Test.pdf":      ("af_vol1","DoD Comptroller (Air Force)", AF.format("FY27-AF-RDTE-Vol1.pdf")),
  "FY27 Air Force Research, Development, Test vol2.pdf": ("af_vol2","DoD Comptroller (Air Force)", AF.format("FY27-AF-RDTE-Vol2.pdf")),
  "FY27 Air Force Research, Development, Test vo 4.pdf": ("af_vol4","DoD Comptroller (Air Force)", AF.format("FY27-AF-RDTE-Vol4.pdf")),
  # Space Force
  "FY27 Space Force Research, Development, Test edx.pdf":("sf_rdte","DoD Comptroller (Space Force)", AF.format("FY27-SF-RDTE.pdf")),
  # NOTE: 'spaceforce.pdf' is mislabeled — it actually contains Air Force PEs (0101.../0203...F),
  # i.e. the AF RDT&E Vol 3 book. Map it accordingly so its provenance is correct.
  "spaceforce.pdf":                                      ("af_vol3","DoD Comptroller (Air Force)", AF.format("FY27-AF-RDTE-Vol3.pdf")),
}

def main():
    os.makedirs(OUTDIR, exist_ok=True)
    grand = []
    for fname,(vol,pub,url) in BOOKS.items():
        pdf = os.path.join(SRC, fname)
        if not os.path.exists(pdf):
            print(f"SKIP (missing): {fname}"); continue
        out = os.path.join(OUTDIR, f"jbook_performers_{vol}.json")
        print(f"--- {vol}: {fname} ---", flush=True)
        r = subprocess.run([sys.executable, TOOL, pdf, "--fy", FY, "--source-url", url,
                            "--volume-id", vol, "--publisher", pub, "--out", out],
                           capture_output=True, text=True)
        line = (r.stdout or r.stderr).strip().splitlines()[-1] if (r.stdout or r.stderr).strip() else "(no output)"
        print("   ", line, flush=True)
        try:
            grand.append((vol, json.loads(line)))
        except Exception:
            grand.append((vol, {"raw": line}))
    # summary
    print("\n==== BATCH SUMMARY ====")
    tot_rows=tot_named=0; pes=set()
    for vol,st in grand:
        rows=st.get("performer_rows",0); named=st.get("named_company_rows",0)
        tot_rows+=rows; tot_named+=named
        print(f"  {vol:18} rows={rows:5} named={named:5} pes={st.get('distinct_pes','?')}")
    print(f"  TOTAL rows={tot_rows} named={tot_named}")

if __name__=="__main__":
    main()
