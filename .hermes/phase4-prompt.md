# Phase 4: The Sellable Artifact — Report Card + Knowledge Graph + Smart Outreach

## YOUR TASK
Implement the three features that close enterprise deals. Per Strategy Report §3 JTBD #6: "How do I prove what I did this quarter? → Auto-generated client/program report card." This is the artifact lobbying firms use to defend $40K/year retainers.

Read existing code FIRST — especially insight-generator.service.ts, intelligence.service.ts, and the Prisma schema.

---

## FEATURE 4.1: Client/Program Report Card Generator

Per Strategy §15.2: "Client/Program Report Card — Branded export. KPI cards (meetings, offices, comments, bills). Outcomes against plan (capability, PE, ask, outcome). Share of voice + district nexus. AI forward-look."
Per §5.4: "Report Card Synthesizer (ClientSubmissionHistory + OutreachRecord + meeting log → quarterly branded deliverable)."
Per §15.2 export spec: "Report card → .docx (Capiro's docx skill pattern), .pdf (Chromium headless). Branded with tenant logo (tenants.logo_s3_key)."

### Backend: Report Card Data Aggregation

Create `apps/api/src/intelligence/report-card.service.ts`:

```
@Injectable() ReportCardService
  constructor(private prisma: PrismaService, private insightGen: InsightGeneratorService)
```

Method: `generateReportCard(clientId: string, tenantId: string, period: 'quarter' | 'year' = 'quarter')`

Aggregates ALL of the following for the given period (last 90 days for quarter, 365 for year):

**A. Activity Metrics (all tenant-scoped via withTenant):**
- Meeting count + list of unique offices met with (from Meeting → attendees → office/title)
- Outreach sent count + open/click rates (from OutreachRecord.stats JSON)
- Tasks completed (from EngagementTask where status='completed')
- Debriefs filed count (from MeetingDebrief)
- Mail threads active (from MailThread count)

**B. Intelligence Metrics (from entity-resolved data):**
- Bills tracked count + breakdown by status (from tracked bills endpoint data)
- Comment periods responded to (from ClientSubmissionHistory where outcomeType involves regulatory)
- Competitor landscape summary (from competitor board data)
- Lobbying ROI: total LDA spend vs federal contracts won (from lobbying-roi endpoint data)

**C. Outcomes (from ClientSubmissionHistory):**
- All submissions for this client in the period
- Grouped by outcomeType: won/in_progress/lost/pending
- For each: title, fiscal year, outcome, capability linked

**D. Engagement Health trend:**
- Weekly health scores over the period (compute for each week)
- Trend: improving/stable/declining

**E. AI Forward-Look:**
- Call the existing AI provider (via insight-generator's callAi method) with all the aggregated data
- Prompt: "Based on this client's activity and intelligence data for the past quarter, write a 3-paragraph forward-looking assessment: (1) key accomplishments and wins, (2) emerging risks and opportunities, (3) recommended priorities for next quarter. Be specific, cite data points."

**Return structure:**
```typescript
interface ReportCardData {
  client: { id: string; name: string; sectorTag: string | null };
  tenant: { name: string; logoS3Key: string | null };
  period: { start: Date; end: Date; label: string };
  activity: {
    meetings: number; uniqueOffices: string[]; outreachSent: number;
    outreachOpenRate: number; tasksCompleted: number; debriefsFiled: number;
    mailThreads: number;
  };
  intelligence: {
    billsTracked: number; billsByStatus: Record<string, number>;
    competitorCount: number; lobbySpend: number; contractWins: number;
  };
  outcomes: Array<{
    title: string; fiscalYear: string; outcomeType: string;
    capability: string | null; notes: string | null;
  }>;
  healthTrend: Array<{ week: string; score: number }>;
  aiForwardLook: string;
  generatedAt: string;
}
```

### Backend: Report Card Export Endpoint

Add to intelligence.controller.ts:
- `GET /intelligence/clients/:clientId/report-card` — returns the ReportCardData JSON
- `GET /intelligence/clients/:clientId/report-card/export?format=json` — returns JSON (same as above)

The .docx export will be handled by a separate script (see below).

### Backend: Report Card .docx Generator Script

Create `apps/api/scripts/generate-report-card-docx.ts`:

This is a standalone script that:
1. Takes clientId and tenantId as args
2. Calls the report card service to get ReportCardData
3. Uses the python-docx pattern (call a Python subprocess or build the docx in Node using `docx` npm package — check if it's in package.json, if not use a simple HTML-to-document approach)
4. Generates a branded .docx with:
   - Header: tenant name + logo (from S3)
   - Title: "[Client Name] — Quarterly Intelligence Report Card"
   - Period: "Q[N] FY[YYYY]"
   - Section 1: Activity Summary (table with metric | value | trend)
   - Section 2: Intelligence Snapshot (bills, competitors, ROI)
   - Section 3: Outcomes (table: submission | FY | outcome | notes)
   - Section 4: Engagement Health (sparkline or text summary of weekly scores)
   - Section 5: Forward Look (AI-generated text)
   - Footer: "Generated by Capiro Intelligence Platform • [date]"
5. Saves to a temp path and returns the path

For MVP, use HTML template → simple formatting. Don't overcomplicate the docx generation.

---

## FEATURE 4.2: Knowledge Graph View (Simple)

Per Strategy §15.2: "Knowledge Graph view — Center: client/program. Satellites: LDA disclosures, lobbyists, contracts, FEC, bills, regulations, committees, members. Strongest 2-hop paths. Resolution quality scorecard."

### Backend: Graph Data Endpoint

Add method to intelligence.service.ts: `getKnowledgeGraph(clientId: string)`

Returns a graph structure with nodes and edges:

**Nodes** (each with id, type, label, metadata):
- Center: the client (type='client')
- LDA registrants linked via ClientIntelMapping (type='registrant')
- Lobbyists from those registrants' filings (type='lobbyist', show covered_positions)
- Federal contractors linked via mapping (type='contractor')
- Bills matched to client's issues (type='bill', top 10 by recency)
- FEC committees receiving contributions from client's employer (type='pac')
- Agencies from client's federal contracts (type='agency')

**Edges** (each with source, target, type, label):
- client → registrant (type='lda_match', label='LDA: confidence%')
- client → contractor (type='contracting_match')
- registrant → lobbyist (type='employs')
- lobbyist → member/office (type='covered_position', label=title)
- client → bill (type='tracks', via issue code)
- client → pac (type='fec_contribution')
- contractor → agency (type='awarded_by')

Add endpoint: `GET /intelligence/clients/:clientId/knowledge-graph`

### Frontend: Knowledge Graph Page

Create `apps/web/src/pages/intelligence/KnowledgeGraphPage.tsx`:
- Route: `/intelligence/client/:clientId/graph`

For MVP, DON'T use a full force-directed graph library (too complex). Instead, use a **hub-and-spoke layout** with AntD components:

- Center: Large Card with client name + stats
- Surrounding ring: Cards for each entity type, grouped by category
- Use AntD Descriptions/List inside each satellite card
- Show edge labels as Tags between center and satellites
- Color-code by entity type: registrant=blue, lobbyist=purple, contractor=green, bill=gold, pac=red, agency=gray
- At the top: "Resolution Quality Scorecard" — average confidence of confirmed mappings, count of unconfirmed

Link from ClientIntelProfilePage: "View Knowledge Graph →" button

---

## FEATURE 4.3: Outreach Personalization with Intelligence Context

Per Strategy §5.4: "Outreach Personalization (existing OutreachAiTemplate; feed in graph signals)."

### Backend: Enhanced Outreach Context

Add method to intelligence.service.ts: `getOutreachContext(clientId: string, tenantId: string, recipientInfo?: { name?: string; office?: string; title?: string })`

This gathers intelligence context that should be injected into outreach drafts:
1. Client's tracked bills (top 5 most recent)
2. Upcoming committee hearings relevant to client's issues (next 14 days)
3. Recent IntelligenceChange events for this client (last 7 days)
4. Comment period deadlines approaching (next 14 days)
5. If recipientInfo.office provided: check if any of client's lobbyists have covered_positions for that office
6. Client's engagement health score

Return: `{ context: string }` — a formatted text block that can be appended to any AI outreach prompt.

Add endpoint: `GET /intelligence/clients/:clientId/outreach-context?recipientOffice=...`

### Frontend: Wire into existing outreach

Check if there's an outreach compose page/drawer. If so, add an "Enrich with Intelligence" button that:
1. Calls the outreach-context endpoint
2. Shows the context in a collapsible panel
3. Optionally auto-injects it into the AI prompt

If no outreach compose UI exists yet, skip the frontend wiring — just build the backend endpoint.

---

## IMPLEMENTATION RULES

1. **READ existing files FIRST** — insight-generator.service.ts, intelligence.service.ts, intelligence.controller.ts
2. **RLS**: withTenant for CRM tables, direct for global tables
3. **Register new services** in intelligence.module.ts
4. **Reuse existing AI call pattern** from insight-generator.service.ts for the forward-look generation
5. **DO NOT** use Parameters<typeof> or conditional spreads in Prisma
6. **Keep .docx generation simple for MVP** — HTML template or basic string-based document, not a complex docx library
