# Phase 0.4: Cross-Reference Endpoints + Missing PATCH endpoint

## YOUR TASK
Add the missing API endpoints that the Phase 0.2 frontend pages reference. Read the existing intelligence.controller.ts and intelligence.service.ts FIRST.

---

## CONTEXT
The frontend pages built in Phase 0.2 call these endpoints that DON'T EXIST YET:

1. `PATCH /intelligence/changes/:id` — called by ChangesInboxPage.tsx to mark a change as consumed (body: `{ consumed: true }`)
2. `GET /intelligence/clients/:clientId/lobbying-roi` — called by ClientIntelProfilePage.tsx for the Lobbying $ vs Contract $ hero stat

Per the Master Strategy Report Section 7 "Cross-Reference Opportunities (no new ingestion)", twelve joins are buildable against today's 80 tables. Implement the highest-value ones as endpoints.

---

## PART 1: PATCH /intelligence/changes/:id (mark-as-read)

Add to intelligence.controller.ts:
```
@Patch('changes/:id')
async markChangeConsumed(@Param('id') id: string, @Body() body: { consumed: boolean }) {
  return this.service.markChangeConsumed(id, body.consumed);
}
```

Add to intelligence.service.ts:
```
async markChangeConsumed(id: string, consumed: boolean) {
  return this.prisma.intelligenceChange.update({
    where: { id },
    data: { consumed },
  });
}
```

Also add `GET /intelligence/changes/unread-count` — returns `{ count: number }` of non-consumed changes in the last 7 days. The AppShell.tsx sidebar badge queries this.

---

## PART 2: Cross-Reference Endpoints (Strategy §7)

These are all pure SQL joins on EXISTING tables via ClientIntelMapping. No new tables needed.

### GET /intelligence/clients/:clientId/lobbying-roi

Per Strategy §7: "Lobbying $ ↔ Contract $ — LdaFiling × FederalContractor via ClientIntelMapping. Lobbying ROI — $ spent on K Street vs. $ won in awards. Headline for every report card."

Implementation:
1. Get confirmed ClientIntelMappings for this client where source = 'lda'
2. From those LDA matches, sum `LdaFiling.income` (the quarterly lobbying income reported)
3. Get confirmed ClientIntelMappings where source = 'contracting'
4. From those contractor matches, sum `FederalContractor.totalObligations` (or similar field — READ the schema first)
5. Return: `{ lobbySpend: number, contractWins: number, roi: number }` where roi = contractWins / lobbySpend

Use raw SQL with joins for efficiency. The tables are GLOBAL (no withTenant needed), but the client_intel_mapping lookup should filter by the tenant's clientId.

### GET /intelligence/clients/:clientId/competitor-board

Per Strategy §7: "Issue ↔ Bill ↔ NAICS ↔ CFDA — Taxonomy bridge." But more directly, the Competitor Surge Detector from §5.1.

Implementation:
1. Get the client's LDA issue codes (from ClientIntelMapping → LdaFiling → LdaIssueCode)
2. Find all OTHER LDA registrants filing on the same issue codes in the last 90 days
3. Group by registrant, count filings, flag new entrants (first filing in 90 days)
4. Return: `{ competitors: Array<{ registrantName, filingCount, isNewEntrant, issueOverlap: string[] }> }`

### GET /intelligence/clients/:clientId/ex-staffers

Per Strategy §7: "Filing-lobbyist ↔ Members — LdaLobbyist.covered_positions × CongressMember. The 'ex-staffer for Senator X' edge."

Implementation:
1. Get the client's LDA registrant (from ClientIntelMapping where source='lda')
2. Get LdaLobbyist records linked to that registrant's filings
3. Filter lobbyists where covered_positions JSON is non-empty
4. Parse covered_positions to extract member/office names
5. Return: `{ lobbyists: Array<{ name, coveredPositions: Array<{ office, title, startDate, endDate }> }> }`

READ the LdaLobbyist model in schema.prisma first to see the exact field structure for covered_positions.

### GET /intelligence/clients/:clientId/bills

Per Strategy §7: "Issue ↔ Bill — LdaIssueCode × CongressBillSubject."

This may already be partially implemented in `getClientProfile()`. Check if `findRelevantBills()` exists. If so, just expose it as a standalone endpoint. If not:

1. Get issue codes from client's LDA mapping
2. Map LDA issue codes to CongressBill subjects/policy_areas (approximate text match)
3. Return matching bills with their latest action and status

---

## CRITICAL RULES

1. READ existing intelligence.service.ts and intelligence.controller.ts FIRST
2. Use `this.prisma.$queryRawUnsafe` or `this.prisma.$queryRaw` for complex joins — same pattern as existing fuzzy match methods
3. Global tables (lda_filing, federal_contractor, etc.) are queried DIRECTLY — no withTenant
4. ClientIntelMapping is also GLOBAL but filtered by clientId (which comes from the tenant's client)
5. Use `Record<string, unknown>` for dynamic where clauses, NOT Parameters<typeof>
6. Match the existing auth guard pattern — the controller already has @UseGuards
7. Add methods to intelligence.service.ts (or create a new cross-reference.service.ts if it's cleaner)
