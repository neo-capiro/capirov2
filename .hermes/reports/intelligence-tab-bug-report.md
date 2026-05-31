# Bug Report — Portfolio > Client Profile > Intelligence Tab

Scope: `apps/web/src/pages/clients/IntelligenceTab.tsx` → `intelligence-v1/*`
(ClientIntelV1Page, 4 sections, ~20 components, mappers.ts) plus the backing
endpoint `GET /api/intelligence/clients/:clientId/profile-v1`.

Build state: `tsc --noEmit` PASS · `vitest` 23/23 PASS · `eslint` not run.
All findings below are logic / data-integrity / UX bugs — none are caught by
the current type or test gates.

================================================================
SEVERITY SUMMARY
  Critical : 1
  High     : 4
  Medium   : 5
  Low      : 4
================================================================

----------------------------------------------------------------
CRITICAL
----------------------------------------------------------------

[C1] Fabricated demo data is shipped as a silent fallback in 3 panels
  Files:
    sections/LegislativeRegulatorySection.tsx  (KANBAN, REGS, HEARINGS consts)
    sections/RelationshipsSection.tsx           (OFFICES const)
    components/DistrictNexusPanel.tsx           (FALLBACK_ROWS const)
  Detail:
    When the aggregate endpoint returns an EMPTY array (a real, common state
    for a client with no confirmed mappings — not an error), the components
    fall back to hardcoded fictitious content:
      - Bill kanban renders fake bills "HR 7702 Mineral Provenance Act",
        "S. 2847 Critical Minerals Stockpile Act", "PL 119-42", etc.
      - Office recommender renders real-named senators with fabricated scores:
        "Sen. Lisa Murkowski (R-AK) 0.94", "Sen. Joe Manchin (I-WV) 0.91", etc.
      - Regulatory lifecycle renders fake EPA dockets with "Comment deadline
        2 days".
      - District nexus renders NV-04 / 92,000 jobs etc.
    Trigger conditions (all use `?.length` falsy → fallback):
      LegislativeRegulatorySection L182  `if (!dynamicKanban?.length) return KANBAN;`
      LegislativeRegulatorySection L239  `: REGS`
      LegislativeRegulatorySection L253  `: HEARINGS`
      RelationshipsSection         L56   `: OFFICES`
      DistrictNexusPanel           L40   `: [...FALLBACK_ROWS]`
  Impact:
    A lobbyist viewing a real client with sparse data sees plausible-looking
    but ENTIRELY FAKE legislative intelligence and named member
    recommendations. This is a trust/compliance hazard — staff could brief a
    client or contact an office based on invented data. Note the kanban has a
    proper "No bills tracked yet" empty state (L275) that only fires when
    counts are zero AFTER the fake KANBAN is already substituted, so the empty
    state is effectively dead code for the dynamic path.
  Fix:
    Replace the demo-data fallbacks with genuine empty states (the kanban
    already has one; reuse the pattern). Gate demo data behind an explicit
    dev/storybook flag, never the production data path.

----------------------------------------------------------------
HIGH
----------------------------------------------------------------

[H1] Kanban column count is wrong after client-side filtering
  File: sections/LegislativeRegulatorySection.tsx  L159
    `const count = controls.filter === 'all' ? col.count : cards.length;`
  Detail:
    `col.count` is the server's TOTAL across all stages for that column, which
    can exceed the (max ~handful) cards actually delivered. When filter='all'
    the column header shows `col.count` but only `cards.length` cards render,
    and the "+N more" overflow in BillKanban (L71 `col.count - visible.length`)
    is computed from that total. With a filter active, count switches to
    `cards.length` — so the same column's header number jumps between two
    different meanings depending on filter. Counts are inconsistent and can
    mislead (header says 28, body shows 3, "+25 more" links nowhere real).
  Fix:
    Decide one semantic. If cards are a truncated preview, keep count=total and
    make "+N more" link to a filtered explorer view. When a filter is applied,
    recompute the total from the filter predicate, not from the rendered slice.

[H2] Health gauge arc geometry is wrong for low scores
  File: sections/SnapshotSection.tsx  HealthGauge L302
    `const deg = Math.round((pct / 100) * 180) - 180;`
  Detail:
    The filled half-ring uses clipPath `inset(0 0 50% 0)` (keeps TOP half) and
    rotates from -180° (score 0) to 0° (score 100) around bottom-center. At low
    scores (e.g. 10 → -162°) the clipped top-half is rotated almost fully to
    the bottom, so the colored arc points DOWN/away from the visible semicircle
    track instead of filling the left side of it. The comment even documents a
    prior overflow bleed that was patched with `overflow:hidden` — but that
    only hides the bleed, it doesn't fix the arc pointing the wrong way. The
    gauge does not read as "10% filled from the left".
  Fix:
    Either flip the clip to the bottom half and sweep 0°→180°, or render the
    arc with an SVG stroke-dasharray approach (far more robust than rotating a
    clipped div).

[H3] Daily-briefing date falls back to "today" and misrepresents freshness
  File: components/BriefingCard.tsx  L97
    `{formatDate(generatedAt ?? new Date().toISOString())}`
  Detail:
    When the briefing has no `generatedAt`, the card stamps the CURRENT date
    next to the "Clio briefing" badge, implying a fresh briefing was generated
    today when none was. Combined with the fallbackSummary path (no real
    briefing), the user sees a confidently-dated briefing built from nothing.
  Fix:
    Only render the date when `generatedAt` is present; otherwise omit or show
    "—". Do not synthesize a timestamp.

[H4] Snapshot "Trajectory" subcopy divides spending by filings using the
     WRONG totals (TTM vs all-time mismatch)
  File: sections/SnapshotSection.tsx  L168-170
    `$${Math.round(profile.lda.totalSpending / profile.lda.totalFilings / 1000)}K/filing avg`
  Detail:
    `totalSpending` and `totalFilings` come from the client-profile endpoint
    and represent different aggregation windows than the trajectory series the
    chip is drawn from (8q). The "avg per filing" is presented under a
    "Trajectory · 8q" label but is an all-time mean, not an 8-quarter figure —
    mislabeled metric. Also no guard against `totalFilings` being a fractional
    or stale value; only `> 0` is checked.
  Fix:
    Compute the average over the same window the chip displays, or relabel the
    delta so it doesn't read as an 8q metric.

----------------------------------------------------------------
MEDIUM
----------------------------------------------------------------

[M1] Bill drill links use raw <a href> SPA-internal routes → full page reload
  File: components/BillKanban.tsx  L100-115 (and OfficeRecommenderList,
        HearingsMarkupList, RegLifecycle, FEC CTA, district CTA all use <a>)
  Detail:
    These hrefs point at in-app routes (/explorer?bill=, /intelligence/issues/…
    /settings/intelligence-mappings) but are plain anchors, not react-router
    <Link>/navigate. Clicking triggers a full document reload, losing SPA
    state, query cache, and scroll position — inconsistent with TopAlertsList /
    SnapshotSection which correctly use `navigate()`.
  Fix:
    Use react-router Link or an onClick→navigate handler for internal routes.

[M2] Activity "Meetings" total mixes two incompatible sources
  File: sections/SnapshotSection.tsx  L123
    `const activityMeetings = activityRows ? sum(meetings) : meetings.length;`
  Detail:
    When the aggregate provides activity14d, meetings = 14-day sum. When it
    doesn't, meetings = length of a 90-DAY meetings query (meetingsFrom L79-82
    fetches 90 days). So the same "Meetings" bar silently represents a 14-day
    count or a 90-day count depending on which endpoint answered — not
    comparable, and the "Activity · 14 days" header is wrong in the fallback
    case.
  Fix:
    Fetch the same 14-day window for the fallback, or drop the fallback bar.

[M3] Regulatory "current stage" match is brittle string equality
  File: sections/LegislativeRegulatorySection.tsx  L208
    `r.stages.findIndex((s) => s.label === r.currentStage)`
  Detail:
    Matches `currentStage` against stage LABELS by exact string. Any casing /
    whitespace / wording drift between the API's `currentStage` and the stage
    label list yields currentIdx = -1, which makes EVERY step render as
    'pending' (L212) — the rail shows no progress at all. Should match on a
    stable key, not a display label.

[M4] Hearings room/chamber confusion
  File: sections/LegislativeRegulatorySection.tsx  L250  `room: h.chamber`
  Detail:
    Dynamic hearings map the chamber ("House"/"Senate") into the `room` field,
    so the list renders the chamber where a room number ("SR-366") is expected
    (the hardcoded HEARINGS use real room codes). The API has no room field, so
    the column header/room slot is misleading. Either source a real location or
    relabel the column.

[M5] FEC candidate de-dup merges distinct people with the same name
  File: components/FecContributionPanel.tsx  L33
    `const key = cand.candidateName.toLowerCase();`
  Detail:
    Candidates are aggregated by lowercased NAME, not by FEC candidate ID.
    Two different candidates sharing a name (common surnames; "John Smith")
    get their contributions summed into one row, and the React key on L133
    (`key={cand.candidateName}`) will also collide. Use the candidate ID.

----------------------------------------------------------------
LOW
----------------------------------------------------------------

[L1] BillKanban React key uses bill number, not unique id
  File: components/BillKanban.tsx  L85/L101 `key={card.num}`
  Detail: A House bill and its Senate companion, or duplicate identifiers
  across a column, produce duplicate React keys → render warnings / state
  bleed. Use a composite key.

[L2] OfficeRecommenderList "All N" count is fabricated when no real total
  File: sections/RelationshipsSection.tsx  L95 `allCount={Math.max(24, offices.length)}`
  Detail: Hardcodes a floor of 24 for the "All 24 →" link even when only 6
  offices exist and there is no 24-item destination. Misleading affordance.

[L3] ResolutionGraph confidence/counts silently invent defaults
  File: components/ResolutionGraphCard.tsx  L37-39, L64
    memberCount ?? 10, lobbyistCount ?? 4, committeeCount ?? 6, avgConfidence ?? 64
  Detail: A missing scopedGraph renders a graph of 20 generic "Member N /
  Lobbyist N" nodes and "64% avg confidence" — another fabricated-data state,
  though less dangerous than C1 since nodes are unnamed. Should render an
  explicit empty/placeholder state.

[L4] IntersectionObserver scroll-spy can flicker the active section
  File: ClientIntelV1Page.tsx  L78-94
  Detail: One observer per section, each setting activeSection on ANY
  intersecting entry with no "most-visible wins" arbitration. With the
  -30%/-55% rootMargin two sections can report intersecting in the same tick,
  causing the left-nav highlight to bounce. Track ratios and pick the max.

================================================================
NOTES / WHAT WAS NOT TESTED
  - No live browser run (no authenticated dev session available); findings are
    from static analysis + backend contract verification + the passing unit/
    type suite. The backend profile-v1 contract MATCHES the frontend types
    (severities are critical|notable|info throughout, so the severityRank
    mapping is correct — NOT a bug).
  - Recommend a runtime pass against a real sparse-data client to confirm C1
    visually and to exercise the health-gauge (H2) at scores 5/45/85.
================================================================
