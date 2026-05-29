Task: Implement D-004 (D4) production-ready for Client Intel v1.

Acceptance:
- Implement hearings/markups list + actions component.
- File: apps/web/src/pages/clients/intelligence-v1/components/HearingsMarkupList.tsx
- Accept when: list context/time/room shown; Sync to calendar + Set alerts are functional.

Instructions:
1) Read first:
   - apps/web/src/pages/clients/intelligence-v1/sections/LegislativeRegulatorySection.tsx
   - apps/web/src/pages/clients/intelligence-v1/mappers.ts
2) Create HearingsMarkupList.tsx and move current hearings list rendering into it.
3) Component props:
   - items (month/day/title/sub/time/room)
   - syncCalendarHref
   - setAlertsHref
4) Ensure actions are always functional anchors with safe fallback hrefs when empty.
5) Wire LegislativeRegulatorySection to use component.
6) Keep existing class names and visuals.
7) No new dependencies.
8) Run:
   - pnpm --filter @capiro/web typecheck
   - pnpm --filter @capiro/api typecheck
9) Output concise changed-files + verification summary.