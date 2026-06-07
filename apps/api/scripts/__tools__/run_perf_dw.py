#!/usr/bin/env python3
"""Extract performers from the 8 Defense-Wide RDT&E books (downloaded to C:/tmp/jbook_pdfs)."""
import os, sys, subprocess, json
TOOL=os.path.join(os.path.dirname(__file__),"extract_jbook_performers.py")
OUTDIR=os.path.abspath(os.path.join(os.path.dirname(__file__),"..","__data__"))
B="https://comptroller.war.gov/Portals/45/Documents/defbudget/FY2027/budget_justification/pdfs/03_RDT_and_E"
DW={
 "dw_mda":("RDTE_Vol2_MDA_RDTE_PB27_Justification_Book.pdf","DoD Comptroller (MDA)"),
 "dw_darpa":("RDTE_Vol1_DARPA_MasterJustificationBook_PB_2027.pdf","DoD Comptroller (DARPA)"),
 "dw_disa":("RDTE_DISA_PB_2027.pdf","DoD Comptroller (DISA)"),
 "dw_dtra":("RDTE_DTRA_PB_2027.pdf","DoD Comptroller (DTRA)"),
 "dw_socom":("RDTE_SOCOM_PB_2027.pdf","DoD Comptroller (SOCOM)"),
 "dw_cbdp":("RDTE_CBDP_PB_2027.pdf","DoD Comptroller (CBDP)"),
 "dw_cybercom":("RDTE_CYBERCOM_PB_2027.pdf","DoD Comptroller (CYBERCOM)"),
 "dw_osw":("RDTE_OSW_PB_2027.pdf","DoD Comptroller (OSW)"),
}
PDFDIR="C:/tmp/jbook_pdfs"
for vol,(fn,pub) in DW.items():
    pdf=os.path.join(PDFDIR, vol+".pdf")
    if not os.path.exists(pdf):
        print(f"SKIP missing {vol} ({pdf})"); continue
    out=os.path.join(OUTDIR, f"jbook_performers_{vol}.json")
    url=f"{B}/{fn}"
    print(f"--- {vol} ---", flush=True)
    r=subprocess.run([sys.executable,TOOL,pdf,"--fy","2027","--source-url",url,
                      "--volume-id",vol,"--publisher",pub,"--out",out],capture_output=True,text=True)
    print("   ", (r.stdout or r.stderr).strip().splitlines()[-1] if (r.stdout or r.stderr).strip() else "(no output)", flush=True)
print("DW BATCH DONE")
