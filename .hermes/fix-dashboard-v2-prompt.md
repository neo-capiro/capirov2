# Fix Dashboard + Settings Mappings

## YOUR TASK
The user reports: "i am not able to see any of the changes. the inbox doesnt show in the dashboard. also remove everything in dashboard except the inbox and the top boxes. remove the per client toggle too. and the sync intel settings fails"

Fix all 4 issues. Read existing code FIRST.

---

## FIX 1: Simplify Dashboard — ONLY keep inbox gadget + top stat boxes

Read `apps/web/src/pages/HomePage.tsx`. The user wants a DRASTICALLY simplified dashboard:

**KEEP:**
- The intelligence gadgets row at the top (Intelligence Updates card, Comment Period Alerts card, Client Health card) — these are the "top boxes"
- The "Intelligence Updates" card IS the inbox gadget — this is what the user wants to see

**REMOVE everything else:**
- Remove the meetings section (upcoming meetings card)
- Remove the tasks section  
- Remove the emails section
- Remove the per-client dropdown/toggle (the `useClientFilter()` selector)
- Remove any client-specific filtering logic

The page should be SIMPLE:
1. Top row: 3 stat cards (Intelligence Updates with unread count, Comment Alerts count, maybe total data sources synced or total clients)
2. Below: the full Intelligence Updates list (the inbox) — NOT limited to 10, show last 50 with pagination
3. Below: Comment Period Alerts (if any)
4. That's it. Nothing else.

**The Intelligence Updates card needs to actually SHOW data.** The API endpoint `GET /intelligence/changes` might return empty because:
- There are no IntelligenceChange rows in the DB yet (the emit-changes.ts script hasn't been run)
- The endpoint might require query params that the frontend isn't sending

Check the API call the HomePage makes and verify it matches the controller's expected params. If the changes table is empty, make the page show a helpful message like "No intelligence changes detected yet. Run the sync to populate data."

## FIX 2: Fix the client toggle removal

In AppShell.tsx or wherever the client filter dropdown appears on the dashboard page — check `useClientFilter()` usage. The user doesn't want a per-client filter on the dashboard. The inbox shows ALL changes across ALL clients.

## FIX 3: Fix Settings > Intelligence Mappings

The `POST /intelligence/resolve-all` endpoint and `GET /intelligence/mappings` endpoint need to work. Check:

1. Read `IntelligenceMappingsPage.tsx` — what API calls does it make?
2. Read the controller endpoints for `resolve-all` and `mappings`
3. Read the service methods they call
4. Common issues:
   - The `resolve-all` endpoint calls `entityResolution.resolveAllForTenant(tenantId)` — the tenantId might not be passed correctly from the auth context
   - The `mappings` endpoint might be calling `getAllMappingsForTenant(tenantId)` but not getting tenantId from the request
   - Check if `@CurrentTenant()` decorator is used and if it provides `ctx.tenantId`

Read the controller code around lines 103 and 172 to see how tenantId is obtained. Compare with other endpoints that work (like `GET /intelligence/client-profile/:clientId`).

## FIX 4: Ensure the inbox data is populated

If `intelligence_change` table is empty, the inbox will show nothing regardless of UI fixes. Create a simple approach:
- Add a "Sync Latest Changes" button on the dashboard that calls a new endpoint
- The endpoint should run the same logic as `emit-changes.ts` but as an API call
- OR just make the page gracefully show "No changes yet — intelligence data will appear after the next sync cycle" with a link to trigger it

---

## IMPLEMENTATION RULES
1. READ existing HomePage.tsx, AppShell.tsx, IntelligenceMappingsPage.tsx, intelligence.controller.ts FIRST
2. Make the dashboard SIMPLE — fewer components, not more
3. Don't break existing functionality
4. The user cares about seeing the inbox on the dashboard — that's the #1 priority
