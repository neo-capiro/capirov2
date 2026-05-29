Task: G-006 -> G6

Goal
Implement hearings calendar and alert destination wiring so BOTH actions preserve selected item context.

Required file
- apps/web/src/pages/clients/intelligence-v1/components/HearingsMarkupList.tsx

Acceptance
- Both action buttons (Sync to calendar, Set alerts) preserve selected hearing/markup context.
- Existing base destination context (e.g., clientId already in href) remains preserved.
- No broken links when no explicit selection has been made yet.

Implementation guidance
- Read the existing HearingsMarkupList.tsx first.
- Add selected-item state in component.
- Build destination hrefs by appending selected item params onto incoming base hrefs.
- Keep URL-safe robust append behavior for URLs with existing query/hash.
- Use a deterministic default selection (first item) so actions always preserve item context.
- Keep implementation production-safe and type-safe.

After editing
- Run web and api typecheck.
- Summarize exactly how selected item context is preserved.