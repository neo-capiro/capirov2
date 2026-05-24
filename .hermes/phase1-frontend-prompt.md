# Phase 1.2: Frontend — Wire Phase 1 Features into Existing Pages

## YOUR TASK
Wire the 5 new Phase 1 backend features into the existing frontend pages. Read existing code FIRST.

---

## CONTEXT — READ THESE FIRST

1. `apps/web/src/pages/intelligence/ClientIntelProfilePage.tsx` (781 lines) — already has hero stats, tabs, "What's New" section. This is where most features land.
2. `apps/web/src/pages/intelligence/ChangesInboxPage.tsx` — already shows changes, needs comment-period alerts highlighted
3. `apps/web/src/App.tsx` — existing routes
4. `apps/web/src/lib/use-api.ts` — axios client via useApi()

New API endpoints to wire (all require auth via useApi):
- `GET /api/intelligence/briefing/:clientId` — enhanced daily briefing with heroSummary, whatsNew[], whatsComing[], suggestedActions[]
- `GET /api/intelligence/clients/:clientId/tracked-bills` — auto-matched bills
- `GET /api/intelligence/issues/:code/leaderboard` — competitor leaderboard per issue
- `GET /api/intelligence/clients/:clientId/health-score` — engagement health 0-100
- `GET /api/intelligence/comment-alerts` — upcoming comment deadlines with relevance

---

## PART A: Enhance ClientIntelProfilePage.tsx

The profile page already has hero stats and tabs. ADD:

**1. Engagement Health Score in hero stats row:**
- Query `GET /api/intelligence/clients/${clientId}/health-score`
- Add a Statistic card showing the score (0-100) as a Progress circle component
- Color: green ≥70, gold 30-69, red <30
- Show trend arrow: ↑ improving, → stable, ↓ declining
- Tooltip showing breakdown (meetings, emails, tasks, debriefs, outreach)

**2. Enhanced AI Briefing section:**
- Query `GET /api/intelligence/briefing/${clientId}`
- Replace simple briefing text with structured layout per Strategy §15.2:
  - **Hero summary** paragraph at top (bold)
  - **"What's New (24h)"** — AntD Timeline of items with source Tags and inline citations
  - **"What's Coming (14d)"** — AntD List of upcoming items with date badges
  - **"Suggested Actions"** — AntD Alert/Card list with urgency tags (high=red, medium=gold, low=blue)
- Each item has a source citation pill (clickable → opens source in drawer)
- Loading skeleton while generating

**3. Tracked Bills tab (new tab, or enhance existing Bills tab):**
- Query `GET /api/intelligence/clients/${clientId}/tracked-bills`
- AntD Table: Identifier (e.g. "H.R.1234"), Title, Status badge, Latest Action, Sponsor, Date
- Status badges: introduced=blue, passed_one=gold, enacted=green, failed=red
- Sort by latest action date

**4. Competitor Leaderboard tab (enhance existing Competitors tab):**
- For each issue code from the client's LDA mapping, query `GET /api/intelligence/issues/${code}/leaderboard`
- Show as expandable sections per issue code
- Each section: AntD Table of registrants with filingCount, totalIncome, isNewEntrant badge (Tag "NEW" in red), shared lobbyists
- Highlight the current client's registrant row

---

## PART B: Comment-Period Alerts in Changes Inbox

Enhance `ChangesInboxPage.tsx`:
- Add a highlighted section at the top: "Open Comment Periods" 
- Query `GET /api/intelligence/comment-alerts`
- Show as Alert/Card list with countdown badges (days remaining)
- Color-code by urgency: <3 days = red pulsing, 3-7 days = gold, 7-14 days = blue
- Each card shows: document title, agency, days remaining, relevant clients (Tags)
- Click → opens Federal Register document URL in new tab

---

## PART C: Standalone Leaderboard Page (Optional but high-value)

Create `apps/web/src/pages/intelligence/IssueLeaderboardPage.tsx`:
- Route: `/intelligence/issues/:code`
- Full-page view of a single issue code's competitor landscape
- Header: Issue code name + total filings + total spending
- Main table: all registrants, sorted by filing count DESC
- New entrant badges, shared lobbyist warnings
- Link back from client profile's competitor tab ("View full leaderboard →")

Add route to App.tsx.

---

## IMPLEMENTATION RULES

1. **READ existing ClientIntelProfilePage.tsx FIRST** — understand the current query pattern, tab structure, hero stats layout
2. **Use useQuery** for all data fetching — match existing pattern
3. **Use useApi()** for axios client
4. **Ant Design 5+ components** — Card, Statistic, Progress, Timeline, Table, Tag, Badge, Alert, Collapse, List
5. **Severity colors**: info=blue, notable=gold, critical=red (per Strategy §15.1)
6. **Handle loading/error states** with AntD Skeleton/Spin/Empty
7. **Handle 404 gracefully** — some endpoints may return null for clients without data
8. **DO NOT install new packages**
