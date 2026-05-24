# Fix: Inbox as Dashboard Gadget Only + Clio Alert Dedup + Settings Page

## YOUR TASK
Fix 4 issues reported by the user. Read existing code FIRST.

---

## FIX 1: Remove Changes Inbox from sidebar nav — keep as dashboard gadget only

The user wants the intelligence changes shown ONLY as a dashboard gadget on the HomePage, NOT as a separate nav item in the sidebar.

In `apps/web/src/components/AppShell.tsx`:
- REMOVE the nav item with `key: 'changes'` (around line 130-134) from the NAV array
- REMOVE `'changes'` from the `AppSection` type union (around line 63)
- KEEP the unread count query (lines ~204-208) — the dashboard gadget still needs it
- Actually, the unread badge can also be removed from the sidebar since there's no nav item to badge. Clean it up.

The route `/intelligence/changes` should STAY in App.tsx so the "View All →" link from the dashboard gadget still works. Just no sidebar nav for it.

## FIX 2: Changes Inbox page not loading

Read `apps/web/src/pages/intelligence/ChangesInboxPage.tsx` and check what API endpoint it calls. The page queries `/api/intelligence/changes` with params. Read the backend `intelligence.controller.ts` to verify:
- Does `GET /intelligence/changes` exist?
- Does the `getChanges` method in `intelligence.service.ts` work correctly?
- Are there query parameter mismatches (e.g., frontend sends `severity` but backend expects different param name)?

Read the actual controller code at the `@Get('changes')` endpoint and the service method it calls. Fix any mismatches.

Also check if the page is properly imported in App.tsx — look for any lazy loading or import that might fail silently.

## FIX 3: Remove duplicate alerts from Clio chatbot

In `apps/web/src/components/chat/ChatDrawer.tsx`:
- The chatbot drawer fetches proactive alerts from `/api/clio/alerts` (line ~111)
- These alerts overlap with IntelligenceChange events shown in the dashboard gadget and Changes Inbox
- REMOVE the alerts section entirely from the ChatDrawer (the `clio-alerts` div around lines 342-350)
- Keep the `alertsBadge` count in the chat toggle button (it's useful), but remove the alert rendering inside the drawer
- If the alerts data is used elsewhere (like the badge count), keep the fetch but remove the visual rendering of alerts inside the drawer

## FIX 4: Intelligence Settings page not loading

In `apps/web/src/pages/settings/SettingsLayout.tsx`:
- The tab `{ key: '/settings/intelligence-mappings', label: 'Intelligence', minRole: 'user_admin' }` exists (line 21)
- Check if the route in App.tsx has `<Route path="intelligence-mappings" element={<IntelligenceMappingsPage />} />` under the `/settings` parent
- Check if `IntelligenceMappingsPage` is properly imported in App.tsx
- Check the IntelligenceMappingsPage.tsx itself for any import errors or missing dependencies
- The page queries `GET /api/intelligence/mappings` — verify this endpoint works

---

## IMPLEMENTATION RULES
1. READ the existing files FIRST — AppShell.tsx, ChangesInboxPage.tsx, ChatDrawer.tsx, SettingsLayout.tsx, App.tsx, intelligence.controller.ts, intelligence.service.ts
2. Make minimal changes — fix the issues, don't rewrite
3. Test that imports are correct after changes
