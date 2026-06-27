# Member press/RSS overlay — discovery & recurring ingestion

Notes for the **News tab** data pipeline. Living doc: methodology now, results below,
and a spec for the recurring ingestion job we'll build next.

## What this feeds

- Directory member profiles have a **News tab** (RSS items + full-article extraction).
- It reads a read-time overlay **`member-press-v1.json`** in S3
  (`s3://updated-directory-967807252336-us-east-1/UPDATED DIRECTORY/overlays/`),
  keyed by `bioguide_id`, values `{ newsPressUrl?, rssFeedUrl?, rssSource? }`.
- Same overlay mechanism as `member-bios-v1.json`; **never** mutates the LegiStorm snapshot.
- Backend reader: `DirectoryService.loadPressOverlay()` (apps/api/src/directory/directory.service.ts).

## History

1. **v1** — built from `Congress_Member_RSS_Feeds.xlsx` (536 members: 376 press, 484 RSS).
2. **v2 (reachability sweep, 2026-06-26)** — dropped dead URLs. Kept only HTTP-200 RSS that
   parse as RSS/Atom/RDF, and reachable press pages. Result: **415 members, 346 RSS, 363 press**;
   140 dead RSS + 13 dead press dropped; 122 members left with no live source. Pre-sweep backed
   up at `overlays/backups/member-press-v1-presweep-20260626.json`.
3. **v3 (discovery, 2026-06-26)** — for every current member missing a live RSS and/or press page,
   discovered + verified a working URL from their official site (website sourced from the snapshot's
   `social_media` "Website, official") and folded it back in. **Result: 536 members (100% of the
   live roster), 491 live RSS, 533 press pages** (added 145 RSS + 170 press; re-added all 121
   previously-empty members). 0 newsletter/contact/press-kit false positives after tightening.
   Prior file backed up at `overlays/backups/member-press-v1-prediscovery-20260626.json`.

### Coverage progression
| Version | Members | Live RSS | Press |
|---|---|---|---|
| v1 (Excel) | 536 | 484 | 376 |
| v2 (swept) | 415 | 346 | 363 |
| v3 (discovery) | 536 | 491 | 533 |

### Working prototype scripts (reference for the TS job)
`docs/plans/member-press-prototype/` — Python, snapshot-driven, run against the overlay JSONs in S3:
- `sweep_overlay.py` — re-verify every URL, drop the dead (reachability sweep → v2).
- `confirm_dropped.py` — retry dropped URLs once to avoid transient false-drops.
- `discover_press.py` — gap-fill discovery (autodiscovery → strict nav → CMS patterns, all verified → v3).
These three together = the full job logic (re-verify + recover + discover). Port to `sync-member-press.ts`.

## Discovery methodology (also the recurring-job logic)

Per member that is missing a live RSS feed and/or a live press page:

1. **Resolve the member's official host** — from the Excel "Official Website", else the host of
   the (now-dead) v1 URLs. Normalize to `https://{host}`.
   - *In the real job, source the website from the LegiStorm snapshot `social_media` (the directory's
     own `officialLinks` "Website" entry), NOT a one-off spreadsheet.*
2. **Fetch the homepage** and try, in order:
   - **RSS autodiscovery**: `<link rel="alternate" type="application/rss+xml|atom+xml" href="...">`.
   - **Press nav link**: anchors whose href/text match `press|news|newsroom|media`.
3. **Fall back to known CMS patterns** (per chamber / template):
   - House Drupal "evo" theme: `/rss.xml` (RSS) + `/media/press-releases` (press) — the dominant House shape.
   - House .NET: `/news/rss.aspx` + `/news/` or `/press-releases`.
   - Senate WordPress: `/feed/` or `/press-releases/feed/` + `/newsroom/press-releases` or `/news/`.
   - Senate classic: `/rss/feeds/?type=all` + `/newsroom/press-releases`.
4. **Verify every candidate before keeping it** (this is what makes it "not guessing"):
   - RSS: HTTP 200 **and** body contains `<rss`/`<feed`/`<rdf:RDF` (parses as a feed); prefer feeds with items.
   - Press: HTTP 200 (reachable), `<400`.
5. Keep the first verified RSS + first verified press. Provenance: `rssSource = "discovered_<yyyymm>"`.
   Never overwrite an already-live URL — only fill gaps.

Notable real-world quirks (carry into the job):
- House Drupal feeds put `/node/N` in `<item><link>` (often 404) while the canonical
  `/media/press-releases/...` URL is in the item body — backend `canonicalArticleLink()` handles this.
- Legacy `http://` ColdFusion feeds (`/common/rss//index.cfm?rss=...`) are dead; the modern host
  usually serves `/rss.xml` now.
- ~30% of "provided (legacy)" feeds were dead; "found" feeds were almost all live.

## Recurring ingestion job — spec (to build next)

- **Where**: `apps/api/scripts/sync-member-press.ts` (tsx), alongside the other `sync-*.ts` jobs;
  scheduled like the existing scheduled sync ECS tasks (NOT the API server task-def — see
  the tsx TMPDIR gotcha; scheduled task-defs run tsx fine).
- **Input**: current member roster + official websites from the **LegiStorm snapshot** (read via the
  same S3 path the directory uses), so new/departed members are picked up automatically.
- **Process**: the 5 discovery steps above, concurrently (bounded pool), with verification.
- **Diff-aware**: start from the existing overlay; (a) re-verify existing URLs and drop ones that went
  dead, (b) discover for members missing a source, (c) keep human-curated entries stable.
- **Output**: write `member-press-v1.json` to the overlays/ prefix; back up the prior file to
  `overlays/backups/` first; embed a `_meta.sweep`/`_meta.discovery` summary + timestamp.
- **Cadence**: weekly is plenty (press pages/feeds change rarely); align with the snapshot refresh.
- **Idempotent**: same roster + same live web state ⇒ same overlay. Safe to re-run.
- **Observability**: log coverage counts each run; alert if live-RSS coverage drops sharply
  (signals a CMS migration broke a pattern).
- **`--commit` flag**: dry-run by default (write local + print report), upload only with `--commit`
  (mirrors the other sync scripts' convention).
