# Fix Intelligence Page + Dashboard Inbox Gadget

## YOUR TASK
Two fixes needed. Read existing code FIRST.

---

## FIX 1: Intelligence page broken — lobby_intel + lobby_issue_ref tables don't exist

The Intelligence Center page calls `LobbyIntelService` which queries `lobby_intel` and `lobby_issue_ref` tables. These tables were DROPPED by migration `20260523050000_drop_openlobby_legacy` and replaced by materialized views `lobby_intel_mv` and `lobby_issue_ref_v` (created in migration `20260522210000_lda_derived_lobby_intel`). 

The Prisma schema has ALREADY been updated to point to the views:
- `LobbyIntel` now maps to `lobby_intel_mv` 
- `LobbyIssueRef` now maps to `lobby_issue_ref_v`

But the `LobbyIntelService` (`apps/api/src/lobby-intel/lobby-intel.service.ts`) may have raw SQL queries that reference the old table names. READ the service file and check for:
1. Any `$queryRaw` or `$queryRawUnsafe` that references `lobby_intel` (not `lobby_intel_mv`) or `lobby_issue_ref` (not `lobby_issue_ref_v`)
2. Fix them to use the view names

Also check if the `LobbyIntelService.lookupByClientName` method (line ~188 per the error logs) references the old table name in raw SQL.

---

## FIX 2: Enable Dashboard + Add Changes Inbox Gadget

The Dashboard page exists at `apps/web/src/pages/HomePage.tsx` (237 lines) but is DISABLED in AppShell.tsx (`disabled: true`). The root route `/` redirects to `/clients`.

### A. Enable Dashboard in AppShell.tsx
- Remove `disabled: true` from the 'home' nav item
- Change the root route in App.tsx from `<Navigate to="/clients">` to `<HomePage />`

### B. Add Changes Inbox gadget to HomePage.tsx
Read the existing HomePage.tsx — it shows upcoming meetings, tasks, and recent emails as cards. ADD a new section:

**"Intelligence Updates" card** — a compact version of the Changes Inbox:
- Query `GET /api/intelligence/changes?limit=10` (most recent 10)  
- Query `GET /api/intelligence/changes/unread-count` for the badge
- Display as an AntD List inside a Card with title "Intelligence Updates" + Badge count
- Each item: severity Tag (color-coded), title, relative time (e.g., "2h ago")
- "View All →" link at bottom that navigates to `/intelligence/changes`
- If no changes, show Empty with "No recent intelligence updates"

**"Comment Period Alerts" card** — urgent regulatory deadlines:
- Query `GET /api/intelligence/comment-alerts`
- Display as AntD Alert components inside a Card
- Color by urgency: <3 days red, 3-7 days gold, >7 days blue
- Show document title (truncated), agency, days remaining
- If none, don't render the card at all

**"Client Health" card** — quick overview of engagement health:
- For the currently selected client (from useClientFilter()), query `GET /api/intelligence/clients/${clientId}/health-score`
- Show the Progress circle with score and trend
- If no client selected, show "Select a client to see health score"

### C. Layout
Keep the existing meeting/task/email sections. Add the new intelligence sections ABOVE the existing content in a 3-column Row:
```
Row gutter={16}:
  Col span={8}: Intelligence Updates card
  Col span={8}: Comment Period Alerts card  
  Col span={8}: Client Health card
```
Then below: the existing meetings + tasks + emails layout.

---

## IMPLEMENTATION RULES
1. READ existing HomePage.tsx, AppShell.tsx, App.tsx FIRST
2. Use existing useApi() and useQuery patterns from HomePage.tsx
3. Use existing useClientFilter() hook (already imported in HomePage)
4. AntD components only — Card, List, Tag, Badge, Progress, Alert, Empty, Row, Col
5. Handle loading/error states
6. DO NOT change the existing meeting/task/email sections — only ADD above them
