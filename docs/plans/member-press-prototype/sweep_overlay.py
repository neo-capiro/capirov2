import json, os, concurrent.futures as cf, requests, openpyxl, datetime

WD = r"C:/Users/neoma/AppData/Local/Temp/aws-api-mcp/workdir/"
XL = r"C:/Users/neoma/OneDrive/Documents/Claude/Projects/capirov2/git/capirov2/Congress_Member_RSS_Feeds.xlsx"
SRC = WD + "member-press-v1.json"
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      "Accept": "application/rss+xml,application/atom+xml,application/xml;q=0.9,text/html;q=0.8,*/*;q=0.7"}

# Load the overlay we built (fallback: rebuild from Excel Members sheet).
if os.path.exists(SRC):
    overlay = json.load(open(SRC, encoding="utf-8"))
    members = overlay["members"]
    meta = overlay.get("_meta", {})
else:
    wb = openpyxl.load_workbook(XL, read_only=True, data_only=True)
    rows = list(wb["Members"].iter_rows(values_only=True)); hdr = rows[0]; idx = {h: i for i, h in enumerate(hdr)}
    def col(r, n):
        v = r[idx[n]] if idx[n] < len(r) else None
        return str(v).strip() if v is not None and str(v).strip() != "" else None
    members = {}
    for r in rows[1:]:
        bid = col(r, "ID")
        if not bid: continue
        e = {}
        if col(r, "News / Press Page"): e["newsPressUrl"] = col(r, "News / Press Page")
        if col(r, "RSS Feed URL"): e["rssFeedUrl"] = col(r, "RSS Feed URL")
        if col(r, "RSS Source"): e["rssSource"] = col(r, "RSS Source")
        if e: members[bid] = e
    meta = {}

FEED_MARKERS = ("<rss", "<feed", "<rdf:rdf", "<?xml")
FEED_ITEM = ("<item", "<entry")

def check_rss(url):
    try:
        r = requests.get(url, headers=UA, timeout=15, allow_redirects=True)
    except Exception as e:
        return ("dead", f"err:{type(e).__name__}")
    if r.status_code != 200:
        return ("dead", f"http:{r.status_code}")
    body = (r.content[:20000].decode(r.apparent_encoding or "utf-8", "replace")).lower()
    is_feed = any(m in body for m in FEED_MARKERS) and ("<rss" in body or "<feed" in body or "<rdf:rdf" in body)
    if not is_feed:
        return ("dead", "not_feed")
    has_items = any(m in body for m in FEED_ITEM)
    return ("live", "items" if has_items else "valid_empty")

def check_page(url):
    try:
        r = requests.get(url, headers=UA, timeout=15, allow_redirects=True, stream=True)
        code = r.status_code
        r.close()
    except Exception as e:
        return ("dead", f"err:{type(e).__name__}")
    return ("live", f"http:{code}") if code < 400 else ("dead", f"http:{code}")

# Build task list
rss_tasks = [(bid, e["rssFeedUrl"]) for bid, e in members.items() if e.get("rssFeedUrl")]
page_tasks = [(bid, e["newsPressUrl"]) for bid, e in members.items() if e.get("newsPressUrl")]
print(f"sweeping {len(rss_tasks)} RSS feeds + {len(page_tasks)} press pages ...", flush=True)

rss_res, page_res = {}, {}
with cf.ThreadPoolExecutor(max_workers=16) as ex:
    fut_rss = {ex.submit(check_rss, u): b for b, u in rss_tasks}
    fut_pg = {ex.submit(check_page, u): b for b, u in page_tasks}
    for f in cf.as_completed(list(fut_rss)): rss_res[fut_rss[f]] = f.result()
    for f in cf.as_completed(list(fut_pg)): page_res[fut_pg[f]] = f.result()

# Regenerate: keep only live URLs; drop members left with neither.
new_members = {}
rss_live = rss_dead = page_live = page_dead = dropped = 0
dead_rss_examples, dead_page_examples = [], []
for bid, e in members.items():
    ne = {}
    if e.get("newsPressUrl"):
        st, why = page_res.get(bid, ("dead", "unchecked"))
        if st == "live": ne["newsPressUrl"] = e["newsPressUrl"]; page_live += 1
        else:
            page_dead += 1
            if len(dead_page_examples) < 10: dead_page_examples.append((bid, e["newsPressUrl"], why))
    if e.get("rssFeedUrl"):
        st, why = rss_res.get(bid, ("dead", "unchecked"))
        if st == "live":
            ne["rssFeedUrl"] = e["rssFeedUrl"]; rss_live += 1
            if e.get("rssSource"): ne["rssSource"] = e["rssSource"]
        else:
            rss_dead += 1
            if len(dead_rss_examples) < 12: dead_rss_examples.append((bid, e["rssFeedUrl"], why))
    if ne: new_members[bid] = ne
    else: dropped += 1

meta = dict(meta)
meta["count"] = len(new_members)
meta["version"] = "v2"
meta["swept_at"] = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
meta["sweep"] = {"rss_live": rss_live, "rss_dead_dropped": rss_dead,
                 "press_live": page_live, "press_dead_dropped": page_dead,
                 "members_dropped_no_urls": dropped}
meta["note"] = ("Overlay only; does NOT modify the LegiStorm snapshot. v2: dead/unreachable "
                "RSS feeds and press pages removed by a reachability sweep (kept only HTTP-200 "
                "feeds that parse as RSS/Atom/RDF, and reachable press pages).")
out = {"_meta": meta, "members": new_members}
json.dump(out, open(WD + "member-press-v2.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)

print("\n===== SWEEP RESULTS =====")
print(f"RSS:   live={rss_live}  dead(dropped)={rss_dead}")
print(f"Press: live={page_live} dead(dropped)={page_dead}")
print(f"members in v2: {len(new_members)}  (dropped entirely, no live urls: {dropped})")
print(f"\ndead RSS examples:")
for b, u, w in dead_rss_examples: print(f"  {b}  {w:12} {u}")
print(f"\ndead press examples:")
for b, u, w in dead_page_examples: print(f"  {b}  {w:12} {u}")
print(f"\nwrote {WD}member-press-v2.json ({os.path.getsize(WD+'member-press-v2.json')} bytes)")
print("SWEEP_DONE")
