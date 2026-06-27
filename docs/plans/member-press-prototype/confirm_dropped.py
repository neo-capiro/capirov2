import json, concurrent.futures as cf, requests

WD = r"C:/Users/neoma/AppData/Local/Temp/aws-api-mcp/workdir/"
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      "Accept": "application/rss+xml,application/atom+xml,application/xml;q=0.9,text/html;q=0.8,*/*;q=0.7"}
FEED_MARKERS = ("<rss", "<feed", "<rdf:rdf")

v1 = json.load(open(WD + "member-press-v1.json", encoding="utf-8"))["members"]
v2doc = json.load(open(WD + "member-press-v2.json", encoding="utf-8"))
v2 = v2doc["members"]

# Dropped URLs = present in v1, absent (for that field) in v2.
dropped_rss = {b: e["rssFeedUrl"] for b, e in v1.items()
               if e.get("rssFeedUrl") and v2.get(b, {}).get("rssFeedUrl") != e["rssFeedUrl"]}
dropped_page = {b: e["newsPressUrl"] for b, e in v1.items()
                if e.get("newsPressUrl") and v2.get(b, {}).get("newsPressUrl") != e["newsPressUrl"]}
print(f"re-checking dropped: {len(dropped_rss)} rss + {len(dropped_page)} press (retry once)", flush=True)

def recheck_rss(url):
    for _ in range(2):
        try:
            r = requests.get(url, headers=UA, timeout=20, allow_redirects=True)
            if r.status_code == 200:
                body = r.content[:20000].decode(r.apparent_encoding or "utf-8", "replace").lower()
                if ("<rss" in body or "<feed" in body or "<rdf:rdf" in body):
                    return True
            return False
        except Exception:
            continue
    return False

def recheck_page(url):
    for _ in range(2):
        try:
            r = requests.get(url, headers=UA, timeout=20, allow_redirects=True, stream=True)
            code = r.status_code; r.close()
            return code < 400
        except Exception:
            continue
    return False

rec_rss, rec_pg = {}, {}
with cf.ThreadPoolExecutor(max_workers=12) as ex:
    fr = {ex.submit(recheck_rss, u): b for b, u in dropped_rss.items()}
    fp = {ex.submit(recheck_page, u): b for b, u in dropped_page.items()}
    for f in cf.as_completed(list(fr)): rec_rss[fr[f]] = f.result()
    for f in cf.as_completed(list(fp)): rec_pg[fp[f]] = f.result()

restored_rss = [b for b, ok in rec_rss.items() if ok]
restored_pg = [b for b, ok in rec_pg.items() if ok]
print(f"recovered on retry: {len(restored_rss)} rss, {len(restored_pg)} press")
for b in restored_rss: print(f"  RSS  {b}  {dropped_rss[b]}")
for b in restored_pg: print(f"  PAGE {b}  {dropped_page[b]}")

# Restore recovered URLs into v2 (re-add member entry if it was dropped).
for b in restored_rss:
    e = v2.setdefault(b, {})
    e["rssFeedUrl"] = dropped_rss[b]
    if v1[b].get("rssSource"): e["rssSource"] = v1[b]["rssSource"]
for b in restored_pg:
    v2.setdefault(b, {})["newsPressUrl"] = dropped_page[b]

# Recompute meta counts
rss_live = sum(1 for e in v2.values() if e.get("rssFeedUrl"))
page_live = sum(1 for e in v2.values() if e.get("newsPressUrl"))
m = v2doc["_meta"]
m["count"] = len(v2)
m.setdefault("sweep", {})
m["sweep"]["rss_live"] = rss_live
m["sweep"]["press_live"] = page_live
m["sweep"]["recovered_on_retry"] = {"rss": len(restored_rss), "press": len(restored_pg)}
json.dump(v2doc, open(WD + "member-press-v2.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print(f"\nFINAL v2: members={len(v2)} rss_live={rss_live} press_live={page_live}")
print("CONFIRM_DONE")
