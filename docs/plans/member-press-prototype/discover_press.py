"""Prototype of the recurring member-press ingestion job (see
docs/plans/member-press-feed-ingestion.md). For every current member missing a
live RSS feed and/or press page, discover + VERIFY a working URL from their
official site (autodiscovery -> nav link -> CMS patterns), and fold it into the
overlay. Never overwrites an already-live URL. Snapshot-driven (no spreadsheet).
Writes member-press-v3.json + discovery_report.json."""
import json, re, gzip, concurrent.futures as cf, requests, datetime
from urllib.parse import urljoin, urlparse

WD = r"C:/Users/neoma/AppData/Local/Temp/aws-api-mcp/workdir/"
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      "Accept": "text/html,application/rss+xml,application/atom+xml,application/xml;q=0.9,*/*;q=0.8"}
TIMEOUT = 12
NOW_TAG = "discovered_202606"

RSS_PATTERNS = ["/rss.xml", "/news/rss.aspx", "/rss/feeds/?type=all", "/feed/",
                "/press-releases/feed/", "/news/feed/", "/?format=feed&type=rss", "/rss/feed", "/rss"]
# Specific press-release paths first; /newsroom and /news are lower-priority indexes.
PRESS_PATTERNS = ["/media/press-releases", "/news/press-releases", "/press-releases",
                  "/newsroom/press-releases", "/media-center/press-releases",
                  "/news/documentquery", "/newsroom", "/news"]
NAV_RE = re.compile(r'<a\b[^>]*href=["\']([^"\']+)["\'][^>]*>(.*?)</a>', re.I | re.S)
ALT_RE = re.compile(r'<link\b[^>]*>', re.I)
# A nav link is a real press page only if its PATH clearly says press-releases /
# newsroom / news-release / media-press — and is NOT a newsletter/contact/kit/feed.
PRESS_GOOD = re.compile(r'(press[-_]?releases?|news[-_]?releases?|newsroom|/media/press|/media-center|/news/?$)', re.I)
PRESS_BAD = re.compile(r'(newsletter|subscribe|sign[-_ ]?up|signup|contact|press[-_ ]?kit|media[-_ ]?kit|presskit|e[-_ ]?news|/rss|/feed|\.xml)', re.I)

def is_feed_body(b):
    b = b.lower(); return ("<rss" in b) or ("<feed" in b) or ("<rdf:rdf" in b)

def get(url, stream=False):
    return requests.get(url, headers=UA, timeout=TIMEOUT, allow_redirects=True, stream=stream)

def verify_rss(url):
    try:
        r = get(url)
        if r.status_code != 200: return None
        body = r.content[:20000].decode(r.apparent_encoding or "utf-8", "replace")
        if is_feed_body(body):
            return "items" if ("<item" in body.lower() or "<entry" in body.lower()) else "valid_empty"
    except Exception:
        return None
    return None

def verify_page(url):
    try:
        r = get(url, stream=True); code = r.status_code; r.close()
        return code < 400
    except Exception:
        return False

def extract_alt_feeds(html, base):
    feeds = []
    for tag in ALT_RE.findall(html):
        t = tag.lower()
        if "alternate" in t and ("application/rss+xml" in t or "application/atom+xml" in t):
            m = re.search(r'href=["\']([^"\']+)["\']', tag, re.I)
            if m: feeds.append(urljoin(base, m.group(1)))
    return feeds

def extract_press_links(html, base, host):
    out, seen = [], set()
    for href, text in NAV_RE.findall(html):
        if href.startswith(("#", "mailto:", "javascript:")): continue
        full = urljoin(base, href)
        if urlparse(full).hostname not in (host, "www." + host): continue
        path = urlparse(full).path
        # Strong press signal in the PATH, and not a newsletter/contact/kit/feed.
        if PRESS_GOOD.search(path) and not PRESS_BAD.search(full):
            if full not in seen: seen.add(full); out.append(full)
    return out[:12]

def discover(host_url):
    res = {"rss": None, "rss_state": None, "press": None, "method_rss": None, "method_press": None}
    base = host_url.rstrip("/")
    host = urlparse(base).hostname or ""
    homepage_html = ""
    try:
        r = get(base)
        if r.status_code == 200 and "html" in (r.headers.get("content-type", "")):
            homepage_html = r.text[:400000]; base = str(r.url).rstrip("/")
    except Exception:
        pass
    for f in extract_alt_feeds(homepage_html, base):
        st = verify_rss(f)
        if st: res.update(rss=f, rss_state=st, method_rss="autodiscovery"); break
    if not res["rss"]:
        for p in RSS_PATTERNS:
            st = verify_rss(base + p)
            if st: res.update(rss=base + p, rss_state=st, method_rss="pattern"); break
    for p in PRESS_PATTERNS:  # specific press-release paths first
        if verify_page(base + p): res.update(press=base + p, method_press="pattern"); break
    if not res["press"]:      # strict nav fallback (press/newsroom paths only)
        for link in extract_press_links(homepage_html, base, host):
            if verify_page(link): res.update(press=link, method_press="navlink"); break
    return res

# ---- Inputs (snapshot-driven) ----
with gzip.open(WD + "member-list-current.json.gz", "rb") as f: ml = json.load(f)
web_by_bid, name_by_bid = {}, {}
for rec in ml:
    mem = rec.get("member") or {}
    bid = mem.get("bioguide_id")
    if not bid: continue
    bid = str(bid).strip()
    prof = mem.get("profile") or {}
    name_by_bid[bid] = f"{prof.get('preferred_first_name') or prof.get('first_name')} {prof.get('preferred_last_name') or prof.get('last_name')}"
    for sm in (rec.get("social_media") or []):
        if sm.get("contact_type") == "Website, official" and sm.get("contact_string"):
            web_by_bid[bid] = sm["contact_string"].strip(); break
live_ids = set(name_by_bid)

v1 = json.load(open(WD + "member-press-v1.json", encoding="utf-8"))["members"]   # original dead-url hosts
v3doc = json.load(open(WD + "member-press-v2.json", encoding="utf-8"))           # start from swept-live
v3 = v3doc["members"]

def host_for(bid):
    w = web_by_bid.get(bid)
    if w: return w if w.startswith("http") else "https://" + w
    for fld in ("rssFeedUrl", "newsPressUrl"):
        u = v1.get(bid, {}).get(fld)
        if u:
            h = urlparse(u).hostname
            if h: return "https://" + h
    return None

targets = []
for bid in live_ids:
    cur = v3.get(bid, {})
    if not cur.get("rssFeedUrl") or not cur.get("newsPressUrl"):
        h = host_for(bid)
        if h: targets.append((bid, h, not cur.get("rssFeedUrl"), not cur.get("newsPressUrl")))
print(f"discovery targets: {len(targets)} members (have official website: {sum(1 for b in live_ids if web_by_bid.get(b))}/{len(live_ids)})", flush=True)

found = {}
with cf.ThreadPoolExecutor(max_workers=16) as ex:
    for bid, r in ex.map(lambda t: (t[0], discover(t[1])), targets):
        found[bid] = r

add_rss = add_press = readd = 0
report = []
for bid, h, need_rss, need_press in targets:
    r = found.get(bid, {}); e = v3.get(bid); created = e is None
    if e is None: e = {}
    got_rss = got_press = None
    if need_rss and r.get("rss"):
        e["rssFeedUrl"] = r["rss"]; e["rssSource"] = NOW_TAG; add_rss += 1; got_rss = r["rss"]
    if need_press and r.get("press"):
        e["newsPressUrl"] = r["press"]; add_press += 1; got_press = r["press"]
    if got_rss or got_press:
        if created: readd += 1
        v3[bid] = e
        report.append({"bid": bid, "member": name_by_bid.get(bid), "host": h,
                       "rss": got_rss, "rss_method": r.get("method_rss"),
                       "press": got_press, "press_method": r.get("method_press")})

m = v3doc["_meta"]; m["version"] = "v3"; m["count"] = len(v3)
m["discovered_at"] = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
m["discovery"] = {"targets": len(targets), "rss_added": add_rss, "press_added": add_press, "members_readded": readd,
                  "rss_live_total": sum(1 for e in v3.values() if e.get("rssFeedUrl")),
                  "press_live_total": sum(1 for e in v3.values() if e.get("newsPressUrl"))}
m["note"] = ("Overlay only. v3: gap-fill discovery from each member's official site "
             "(autodiscovery/nav/CMS patterns, every candidate HTTP-verified). "
             "rssSource='discovered_*' marks discovered feeds. Snapshot is never modified.")
json.dump(v3doc, open(WD + "member-press-v3.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
json.dump(report, open(WD + "discovery_report.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)

print("\n===== DISCOVERY RESULTS =====")
print(f"targets={len(targets)}  rss_added={add_rss}  press_added={add_press}  members_readded={readd}")
print(f"v3 totals: members={len(v3)}  rss_live={m['discovery']['rss_live_total']}  press_live={m['discovery']['press_live_total']}")
print("\nsample discoveries:")
for row in report[:18]:
    print(f"  {row['bid']} {str(row['member'])[:20]:20} rss={str(row['rss_method']):13}{str(row['rss'])[:44]:44} press={str(row['press_method']):8}{str(row['press'])[:40]}")
print("\nwrote member-press-v3.json + discovery_report.json")
print("DISCOVERY_DONE")
