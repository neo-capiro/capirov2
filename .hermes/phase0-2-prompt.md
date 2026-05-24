# Phase 0.2: Frontend — Changes Inbox + Client Intelligence Profile + Mappings Review UI

## YOUR TASK
Implement the three frontend surfaces from the Capiro Master Strategy Report (Sections 10.1, 15.2). Read existing code FIRST to match patterns exactly.

---

## CONTEXT — READ THESE FILES FIRST

1. `apps/web/src/components/AppShell.tsx` — the sidebar nav. Has NAV[] array of NavItem objects with key/label/path/icon. You'll add a new nav item here.
2. `apps/web/src/App.tsx` — React Router routes. Uses `<Route path="..." element={...} />` pattern.
3. `apps/web/src/pages/intelligence/IntelligenceCenterPage.tsx` — existing intelligence page with Tabs, useQuery, useApi pattern. 
4. `apps/web/src/pages/intelligence/panels/ClientProfilePanel.tsx` — existing client profile panel.
5. `apps/web/src/pages/settings/SettingsLayout.tsx` — settings tabs with role-filtered items. You'll add a new tab here.
6. `apps/web/src/lib/use-api.ts` — returns an axios client. All API calls use `api.get('/path')`, `api.post('/path', body)`, `api.patch('/path', body)`.
7. `apps/web/src/pages/intelligence/types.ts` — existing TypeScript interfaces for intelligence data.

The app uses: React 18, Ant Design 5+, @tanstack/react-query, react-router-dom v6, axios via useApi().

---

## PART E: Changes Inbox Page

Per Strategy Report Section 15.2: "Changes Inbox — Cross-profile severity-sorted feed. Filters: source / severity / profile. Read state per user. Unread badge on nav."

Per Section 10.1 Q3 scope: "Changes Inbox UI."

### Create: `apps/web/src/pages/intelligence/ChangesInboxPage.tsx`

This page displays `IntelligenceChange` records from the API. The backend endpoint `GET /intelligence` already exists (read intelligence.controller.ts to confirm the exact route). If it only returns insights, you may need `GET /intelligence/changes` — check what endpoints exist.

**Layout (per Strategy Report §15.2 visual spec):**
- Page title: "Changes Inbox" with unread count Badge
- Filter bar at top: source (multi-select dropdown of distinct sources), severity (dropdown: all/info/notable/critical), date range picker
- Main content: AntD Table (or List with Cards) sorted by `detectedAt` DESC
- Columns:
  - Severity: AntD Tag with color semantics — info=blue, notable=gold, critical=red (per §15.1 "severity semantics reserved for severity")
  - Source: AntD Tag (e.g., "SEC Filing", "Congress Bill", "Federal Register")
  - Title: text, clickable
  - Description: truncated to 120 chars with tooltip for full text
  - Detected: relative time (e.g., "2 hours ago") using dayjs
- Click row → expand to show full description + data JSON in a collapsible panel or Drawer
- Mark-as-read: when row is expanded, PATCH the record's `consumed` field to true

**API calls:**
- `api.get('/intelligence/changes', { params: { source, severity, limit, offset } })` — you may need to check/create this endpoint
- `api.patch('/intelligence/changes/:id', { consumed: true })`

### Update: `apps/web/src/components/AppShell.tsx`
- Add a nav item for Changes Inbox. Insert it near the existing 'intelligence' item. Use `BellOutlined` or `AlertOutlined` icon.
- Show an unread count badge on this nav item (query unread count from API)

### Update: `apps/web/src/App.tsx`
- Add route: `<Route path="/intelligence/changes" element={<ChangesInboxPage />} />`
- Make sure the existing `/intelligence/*` catch-all doesn't override it — the specific route must come BEFORE the wildcard.

---

## PART F: Enhanced Client Intelligence Profile

Per Strategy Report Section 15.2: "Client Intelligence Profile — Hero stats (trajectory, FY spend, contracts, exposures). What's new this week. Lobbying landscape + competitor leaderboard. AI briefing with citations."

Per Section 10.1: "ClientIntelligenceProfile endpoint + page."

The backend endpoint `GET /intelligence/clients/:clientId/profile` already exists in intelligence.service.ts (`getClientProfile` method). It returns fuzzy matches and related data. Phase 0.1 enhanced it to use confirmed `ClientIntelMapping` entries.

### Create: `apps/web/src/pages/intelligence/ClientIntelProfilePage.tsx`

This is a dedicated full-page view for a single client's intelligence profile. It's separate from the panel in IntelligenceCenterPage.

**Layout (per Strategy Report §15.2):**
- Hero row at top with 4-6 AntD Statistic cards:
  - Total LDA Spend (from lobbySpend or filings)
  - Federal Contracts Won (from contractors)
  - Active Bills Tracked (count)
  - Engagement Health Score (placeholder 0-100, show as Progress circle)
  - Active Regulations (count)
  - Mapping Confidence (average confidence of confirmed mappings)

- Section: "What's New This Week" — recent IntelligenceChange records related to this client (where `relatedClientIds` contains this clientId)

- Tabbed detail sections:
  - **LDA Filings** tab: Filing history from LDA match — registrant, issue codes, income, lobbyists list. Use data from the profile endpoint's `lda` field.
  - **Federal Contracts** tab: Contractor awards — agency, amount, NAICS. From `contracting` field.
  - **SEC Filings** tab: Recent SEC filings — type, date, description. From `sec` field.
  - **Related Bills** tab: Bills matched via issue codes — identifier, title, status, latest action. From `relevantBills` field.
  - **Regulations** tab: Active Federal Register documents matched to this client. From `activeRegulations` field.
  - **Competitors** tab: Other firms/clients lobbying on the same issues. From `competitors` field.
  - **FEC Contributions** tab: Political contributions linked to this client's employer name. From `fec` field if available.

  Each tab shows a count Badge next to the tab title.

- Per Strategy Report §15.1: "Citations: every AI-generated paragraph carries inline source pills. Click → drawer with source record."

**API call:** `api.get('/intelligence/clients/${clientId}/profile')`

### Update routing:
- `apps/web/src/App.tsx`: Add `<Route path="/intelligence/client/:clientId" element={<ClientIntelProfilePage />} />`
- Make existing client list items (in ClientWorkspacePage or wherever clients are listed) link to this profile page

---

## PART G: Intelligence Mappings Review UI

Per Strategy Report Section 10.1: "Mappings review UI in Settings → Intelligence Mappings."
Per Section 4.2 Stage D: "Human-in-the-loop. Auto-confirm ≥ 0.85; review queue at 0.5–0.85."

### Create: `apps/web/src/pages/settings/IntelligenceMappingsPage.tsx`

**Layout:**
- Page title: "Intelligence Mappings"
- "Resolve All Clients" button (primary, top-right): calls `POST /intelligence/resolve-all`, shows loading state, then refreshes. Display the ResolutionSummary result in a notification (X created, Y auto-confirmed, Z need review).
- Main content: AntD Table grouped by client name
  - Columns: Client Name (grouped header), Source (Tag), External Name, Confidence (AntD Progress bar, color-coded: green ≥0.85, gold 0.5-0.85, red <0.5), Confirmed (Switch component)
  - Toggle the Switch → calls `PATCH /intelligence/mappings/:id` with `{ confirmed: true/false }`
- Bulk actions toolbar:
  - "Confirm All ≥ 0.85" button
  - "Reject All < 0.5" button
- Filter: search by client name, filter by source, filter by confirmation status

**API calls:**
- `api.get('/intelligence/mappings')` → returns grouped mappings
- `api.post('/intelligence/resolve-all')` → triggers batch resolution
- `api.patch('/intelligence/mappings/:id', { confirmed: boolean })` → confirm/reject

### Update: `apps/web/src/pages/settings/SettingsLayout.tsx`
- Add to the tabs array: `{ key: '/settings/intelligence-mappings', label: 'Intelligence', minRole: 'user_admin' }`

### Update: `apps/web/src/App.tsx`
- Add nested route under `/settings`: `<Route path="intelligence-mappings" element={<IntelligenceMappingsPage />} />`

---

## PART H: Wire Cross-Reference Endpoints to Client Profile

The Phase 0.1 backend added cross-reference endpoints per Strategy Report Section 7. If these endpoints exist, wire them into the ClientIntelProfilePage:

- `GET /intelligence/clients/:id/lobbying-roi` → Show Lobbying $ vs Contract $ as a hero stat (Strategy §7: "Lobbying ROI — $ spent on K Street vs. $ won in awards. Headline for every report card.")
- `GET /intelligence/clients/:id/competitor-board` → Powers the Competitors tab
- `GET /intelligence/clients/:id/bills` → Powers the Bills tab  
- `GET /intelligence/clients/:id/ex-staffers` → Show in a section: "Lobbyists with Hill Experience" (Strategy §7: "The 'ex-staffer for Senator X' edge")

If these endpoints don't exist yet, still build the UI components but with placeholder states showing "Coming soon" or disabled tabs.

---

## CRITICAL IMPLEMENTATION RULES

1. **READ existing files FIRST** — match the exact import style, component patterns, hooks usage
2. **Use `useQuery` from @tanstack/react-query** for all data fetching (match existing pattern in IntelligenceCenterPage.tsx)
3. **Use `useApi()`** hook for the axios client (already in lib/use-api.ts)
4. **Use Ant Design 5+** components: Card, Table, Tabs, Tag, Badge, Statistic, Progress, Switch, Select, DatePicker, Button, Drawer, notification
5. **Severity color semantics** (per §15.1): info=blue (#1890ff), notable/warning=gold (#faad14), critical/danger=red (#ff4d4f)
6. **Typography**: AntD default. Headlines 18-22px, body 14px, captions 12px (per §15.1)
7. **Do NOT install new npm packages** — use what's already in package.json
8. **Match the existing file naming pattern**: PascalCase component names, `.tsx` extension
9. **All pages must be properly exported** and imported in App.tsx with lazy loading if the existing pattern uses it
