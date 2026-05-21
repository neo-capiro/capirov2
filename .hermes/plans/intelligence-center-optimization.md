# INTELLIGENCE CENTER — ANALYSIS & OPTIMIZATION RECOMMENDATIONS
## Capiro Platform · May 2026

---

## CURRENT STATE

### What's Live (9 Tabs)

| Tab | Data Source | Tables | Key Metrics | Interactive? |
|-----|-----------|--------|-------------|-------------|
| LDA Overview | Senate LDA API | lda_filing, lda_client, lda_registrant, lda_lobbyist, lda_issue_code, lda_government_entity | 525K+ filings, 134K clients, 17K firms, 88K lobbyists, 79 issue codes | Click issue → drilldown to top clients |
| Filings | Senate LDA | lda_filing | Paginated table with filters (client, firm, year, issue) | Search/filter only |
| Firms | Senate LDA | lda_registrant | Paginated table | Search only |
| Lobbyists | Senate LDA | lda_lobbyist | Paginated table | Search only |
| Congress | Congress.gov API | congress_bill | ~10K bills (118th + 119th) | Paginated table |
| PACs | FEC API | fec_committee, fec_contribution | ~5K committees | Paginated table |
| Contracting | OpenSpending | federal_contractor | Top 100 contractors, yearly spend, no-bid | Sparklines on spending |
| Agencies | OpenSpending | federal_agency | 97 agencies, budget, top contractors | Sparklines on budget |
| Lobby Intel | OpenLobby | lobby_intel, lobby_issue_ref, lobby_trending_topics | 5.2K clients, issue trends, surge detection | Trajectory tags, surge badges |

### What's Good
- Hero stats cards with color-coded icons (LDA Overview)
- Quarterly trend area chart (filings + income over time)
- Issue area drilldown (click issue → see top clients)
- HBar sparklines for visual comparison
- Surge/trajectory detection on lobby intel
- Federal spending already injected into AI outreach prompts

### What's Weak
1. **Tables are display-only** — no click-through, no linking between tabs, no entity pages
2. **No cross-referencing** — can't go from a client → their filings → their lobbyists → their bills → their spending. Each tab is siloed.
3. **No AI layer** — no summaries, no anomaly detection, no "what changed" alerts
4. **No time comparisons** — can't compare Q1 2025 vs Q1 2024 for any metric
5. **No client context** — Intelligence Center is global, not tied to the client you're working on
6. **Charts are minimal** — one trend chart. No treemaps, no network graphs, no geographic views.
7. **Missing fields from APIs** — we sync a fraction of what's available

---

## DATA SOURCES: WHAT WE USE vs WHAT'S AVAILABLE

### Senate LDA (ALREADY SYNCING)
| Field | Syncing? | Using in UI? | Notes |
|-------|----------|--------------|-------|
| Filing UUID, type, year, period | ✅ | ✅ | Core identifiers |
| Income / expenses | ✅ | ✅ | Shown in tables and charts |
| Client name, state | ✅ | ✅ | Searchable |
| Registrant name, city, state | ✅ | ✅ | Shown in firms tab |
| Lobbyist first/last name | ✅ | ✅ | Shown in lobbyists tab |
| Covered positions (revolving door) | ✅ | ❌ | **HIGH VALUE — not displayed** |
| Issue codes per filing | ✅ | ✅ | Tags + drilldown |
| Government entities per filing | ✅ | ✅ | "Government Targets" card |
| Lobbying activity descriptions | ❌ | ❌ | **FREE TEXT — gold for AI summarization** |
| Client general description | ❌ | ❌ | **Useful for client matching** |
| Registrant description | ❌ | ❌ | Firm capability description |
| Registrant contact info | ❌ | ❌ | Phone, address — lead gen |
| Filing dt_posted | ✅ | Partially | Only in trends, not in recency signals |

### FEC (ALREADY SYNCING)
| Field | Syncing? | Using in UI? | Notes |
|-------|----------|--------------|-------|
| Committee name, type, party, state | ✅ | ✅ | PACs tab |
| Total receipts/disbursements/COH | ✅ | ✅ | Financial summary |
| Individual contributions (schedule_a) | Partial | ❌ | **Can link donors to lobbying clients** |
| Disbursements (schedule_b) | ❌ | ❌ | Where PAC money goes |
| Candidate links | ❌ | ❌ | **Connect PACs → Members of Congress** |

### Congress.gov (ALREADY SYNCING)
| Field | Syncing? | Using in UI? | Notes |
|-------|----------|--------------|-------|
| Bill number, title, type | ✅ | ✅ | Congress tab |
| Sponsor name, state, party | ✅ | ✅ | Shown in table |
| Latest action text/date | ✅ | ✅ | Status tracking |
| Policy area | ✅ | ✅ | Filterable |
| Cosponsors count | ✅ | ✅ | Shown |
| Full bill text / amendments | ❌ | ❌ | **Critical for document generation** |
| Committee referrals | ❌ | ❌ | **Maps to submission tracks** |
| Subjects/tags | ❌ | ❌ | **Better than policy area for matching** |
| Related bills | ❌ | ❌ | Cross-referencing |
| Actions history (all, not just latest) | ❌ | ❌ | **Bill movement timeline** |

### USAspending (ALREADY SYNCING via OpenSpending)
| Field | Syncing? | Using in UI? | Notes |
|-------|----------|--------------|-------|
| Top contractors, agencies, industries | ✅ | ✅ | Contracting + Agencies tabs |
| Yearly spend trends | ✅ | ✅ | Sparklines |
| No-bid awards | ✅ | ✅ | Transparency metric |
| Individual award details | ❌ | ❌ | **Contract-level data for client intel** |
| NAICS codes | ❌ | ❌ | Industry classification |
| Place of performance | ❌ | ❌ | **District-level impact for submissions** |
| Sub-award data | ❌ | ❌ | Supply chain intelligence |
| Grant data | ❌ | ❌ | Non-contract federal awards |

---

## YOUR DATA SOURCE WISHLIST — STATUS

| Source | Status | Recommendation |
|--------|--------|----------------|
| Congress.gov API | ✅ SYNCING — bills only | **Expand**: add committee referrals, subjects, actions history, bill text |
| Senate LDA API | ✅ SYNCING — 525K+ filings | **Expand**: add lobbying activity descriptions, client descriptions |
| FEC / OpenSecrets | ✅ SYNCING — committees + contributions | **Expand**: add candidate links, disbursements, donor-to-client mapping |
| USAspending.gov | ✅ SYNCING — via OpenSpending | **Expand**: add individual awards, NAICS, place of performance |
| Federal Register API | ❌ NOT STARTED | **Priority 1 for doc gen** — rules, comment periods, regulatory timelines |
| Regulations.gov API | ❌ NOT STARTED | **Priority 1 for doc gen** — dockets, agency comments, regulatory filings |
| House/Senate Committee Pages | ❌ NOT STARTED | **Priority 2** — hearing schedules, witness testimony, markup schedules |
| Agency Budget Justifications | ❌ NOT STARTED | **Priority 2** — program priorities, funding rationale |
| CRS/GAO Reports | ❌ NOT STARTED | **Priority 2** — policy analysis, program evaluations |
| LegiStorm | ❌ NOT STARTED | **Priority 3** — would supplement congressional directory (staff tracking) |
| Official Member Websites | ❌ NOT STARTED | **Priority 3** — press releases, district priorities |
| News (Punchbowl, Roll Call, etc.) | ❌ NOT STARTED | **Priority 3** — political momentum, timing signals |
| SEC Filings | ❌ NOT STARTED | **Priority 4** — client financial context for in-house GA |
| BLS/Census/BEA | ❌ NOT STARTED | **Priority 4** — economic impact data for submissions |
| State legislature portals | ❌ NOT STARTED | **Phase 2 expansion** |
| FARA filings | ❌ NOT STARTED | **Niche — add when international track opens** |
| Trade associations | ❌ NOT STARTED | **Manual/AI curated — not a sync target** |
| Think tanks | ❌ NOT STARTED | **Manual/AI curated** |
| Social media | ❌ NOT STARTED | **Phase 3 — sentiment monitoring** |
| Client CRM / Internal Systems | ✅ LIVE | Already integrated via engagement module (meetings, email, tasks) |

---

## OPTIMIZATION RECOMMENDATIONS

### TIER 1: HIGH IMPACT, BUILD NOW (Weeks 1-4)

#### 1. Cross-Entity Navigation (click-through everything)
Every entity in the Intelligence Center should be clickable and link to related entities:
- Click a **client** → see all their filings, lobbyists, issue areas, spending, related bills
- Click a **firm** → see all their clients, lobbyists, total billings, issue specialization
- Click a **lobbyist** → see their firms, clients, covered positions (revolving door!)
- Click an **issue code** → see clients, firms, filings, spending, trending, related bills
- Click a **bill** → see sponsor, cosponsors, committee referrals, related LDA filings on that issue
- Click a **contractor** → see their spending by agency, awards, related LDA clients

This turns siloed tables into an interconnected intelligence graph. The data relationships already exist in the DB — we just need entity detail pages and navigation.

#### 2. Client-Contextualized Intelligence
When a user is working on a specific client, the Intelligence Center should filter to show:
- That client's LDA filing history
- That client's lobbying firm and fellow clients at the same firm
- Issue areas that client lobbies on → trending analysis for those issues
- Federal spending in that client's industry/sector
- Bills related to that client's issue codes
- Congressional members on committees relevant to that client

Add a "Client Context" toggle at the top of the Intelligence Center: off = global view, on = filtered to selected client.

#### 3. AI Insight Cards
Add an "AI Insights" panel at the top of each tab that auto-generates 3-5 observations:
- **LDA**: "Defense lobbying spending surged 23% QoQ — driven by HCR (Health) and DEF (Defense) issue codes. Top new entrant: [Client X] with $2.3M in Q1 filings."
- **Congress**: "3 defense authorization bills introduced this week. H.R. 4521 has 12 cosponsors from HASC — potential vehicle for client submissions."
- **Contracting**: "Lockheed Martin's DoD contract volume up 15% YoY. Navy NAVSEA awards trending above 5yr average."

Generate these server-side on a schedule (daily/weekly) or on-demand with a "Refresh Insights" button. Store in a new `intelligence_insight` table.

#### 4. Revolving Door Display
We sync lobbyist `covered_positions` (former government roles) but don't display them. This is EXTREMELY valuable for lobbyists — knowing that a lobbyist previously worked as a Legislative Assistant to a specific senator, or was a DoD program manager, is critical intelligence for engagement strategy.

Add to Lobbyists tab: "Former Positions" column showing government roles. Add to entity detail pages: highlight when a lobbyist has relevant prior government experience for the issue being discussed.

#### 5. Time Comparison Dashboard
Add period-over-period comparison:
- QoQ change in filing volume per issue code
- YoY change in spending per client/firm
- New entrants (clients/firms that appeared in the last quarter but not the prior)
- Disappearances (clients that stopped filing)
- Spending velocity changes (accelerating vs decelerating)

This data already exists in the `lda_filing` table — we just need aggregation queries.

### TIER 2: MEDIUM IMPACT, BUILD WEEKS 4-8

#### 6. Federal Register Integration (NEW DATA SOURCE)
**API**: `https://www.federalregister.gov/api/v1/`
**Free, no auth, well-documented**

Sync: proposed rules, final rules, notices, comment period deadlines
New table: `federal_register_document` (document_number, title, type, abstract, agency, publication_date, comment_end_date, docket_ids, cfr_references)

This is **critical for document generation** — when drafting a submission about a specific program, the AI needs to reference current regulatory actions affecting that program. Comment period deadlines create urgency signals.

New tab: "Regulations" — upcoming comment deadlines, recently finalized rules, agency rulemaking activity.

#### 7. Regulations.gov Integration (NEW DATA SOURCE)
**API**: `https://api.regulations.gov/v4/`
**Auth**: Free API key from regulations.gov

Sync: dockets, public comments, agency documents
New table: `regulatory_docket` (docket_id, agency, title, type, last_modified, comment_count, open_for_comment)

Pairs with Federal Register — shows the comment activity and public participation side.

#### 8. Enhanced Congress Data
Expand the congress sync script to pull:
- **Committee referrals**: which committee has jurisdiction over each bill
- **Subjects**: detailed subject tags (better than single policy_area)
- **Actions history**: full timeline of bill movement (introduced → committee → markup → floor → conference → signed)
- **Bill text**: full text via GovInfo (for AI document generation grounding)

New tables: `congress_bill_committee`, `congress_bill_subject`, `congress_bill_action`

This makes the Congress tab actionable — a lobbyist can see which bills are moving through which committees, track markup schedules, and identify submission timing windows.

#### 9. Network Visualization
Add a visual graph showing relationships between:
- Clients ↔ Firms ↔ Lobbyists ↔ Issue Areas ↔ Government Entities

Use a force-directed graph (D3.js or react-force-graph) showing clusters of related entities. This reveals:
- Which firms dominate which issue areas
- Which clients share lobbyists (potential coalition partners or competitors)
- Which government entities receive the most lobbying attention

This is the "intelligence graph" that makes Capiro feel like a real intelligence platform, not just a data browser.

#### 10. Anomaly Detection & Alerts
Automated detection of notable changes:
- **Spending spike**: Client X increased lobbying spend by 300% QoQ
- **New entrant**: Company Y registered as a new lobbying client this quarter
- **Issue surge**: Issue code TAX (Taxation) filings up 45% — highest in 3 years
- **Revolving door**: New lobbyist registered who previously served as [Government Role]
- **Contract award**: Client's federal contract value doubled YoY

Store alerts in an `intelligence_alert` table. Surface as a notification badge on the Intelligence Center tab. Users can subscribe to alert categories.

### TIER 3: HIGH VALUE FOR DOC GENERATION, BUILD WEEKS 8-12

#### 11. Document Generation Context Pipeline
Create a `DocumentContextBuilder` service that aggregates intelligence for AI document generation:

```
Input: client_id + submission_type + target_committee
Output: {
  clientProfile: { name, LDA history, spending, industry, programs },
  regulatoryContext: { active rules, comment periods, recent agency actions },
  legislativeContext: { related bills, committee activity, sponsor positions },
  competitiveContext: { other clients lobbying same issues, spending comparison },
  economicContext: { industry employment, district impact, federal spending trends },
  historicalContext: { prior submissions, success rate, prior year language },
  talkingPoints: AI-generated from all above
}
```

This becomes the intelligence backbone for every white paper, submission, and outreach email the platform generates.

#### 12. CRS/GAO Report Integration
**Source**: everycrsreport.com (free) or CRS Reports via Congress.gov
CRS reports provide neutral policy analysis that's perfect for grounding AI document generation. A white paper that cites CRS analysis is more credible than one that doesn't.

Sync: report title, summary, date, topics, PDF link
New table: `crs_report` (report_id, title, summary, date, topics, url)

Match CRS reports to issue codes → surface relevant reports when generating submissions.

#### 13. Agency Budget Justification Extraction
DOD R-2 exhibits, DOE budget justifications, HHS operating plans — these contain the program-level detail that submissions reference.

This is more complex (PDF extraction + structured parsing) but extremely high value for defense submissions. The R-2 data maps directly to PE numbers, funding history, and program descriptions.

#### 14. Predictive Intelligence
Using historical data patterns:
- **Bill passage probability**: Based on sponsor, committee, cosponsors, similar prior bills
- **Spending trajectory**: Forecast next-quarter lobbying spend by issue area
- **Submission timing optimizer**: Based on historical deadline patterns, recommend optimal filing dates
- **Issue heat map**: Predict which issues will surge next quarter based on legislative calendar + historical patterns

These require enough historical data (which we now have — 5 years of LDA filings) to build meaningful models.

---

## IMPLEMENTATION PRIORITY ORDER

| Phase | What | Impact | Effort | Timeline |
|-------|------|--------|--------|----------|
| 1A | Cross-entity navigation (click-through) | High | Medium | Week 1-2 |
| 1B | Client-contextualized intelligence | High | Medium | Week 2-3 |
| 1C | AI insight cards (auto-generated) | High | Low | Week 3 |
| 1D | Revolving door display | High | Low | Week 1 |
| 1E | Time comparison dashboard | High | Medium | Week 3-4 |
| 2A | Federal Register sync | High (doc gen) | Medium | Week 4-5 |
| 2B | Regulations.gov sync | High (doc gen) | Medium | Week 5-6 |
| 2C | Enhanced Congress data | High (doc gen) | Medium | Week 6-7 |
| 2D | Network visualization | Medium | Medium | Week 7-8 |
| 2E | Anomaly detection + alerts | High | Medium | Week 8 |
| 3A | Document context pipeline | Critical (doc gen) | High | Week 8-10 |
| 3B | CRS/GAO reports | Medium (doc gen) | Low | Week 10-11 |
| 3C | Agency budget extraction | High (defense) | High | Week 11-12 |
| 3D | Predictive intelligence | Medium | High | Week 12+ |

---

## SUMMARY

**What you have**: A solid data foundation — 5 years of LDA filings (525K+), FEC committees,
congressional bills, federal spending, and lobby intelligence. All searchable. All displayed
in 9 tabs.

**What you're missing**: The connections between the data, the AI layer on top, and the
regulatory/legislative context that makes document generation smart. The data is there but
it's presented as isolated tables instead of an interconnected intelligence graph.

**Biggest quick wins**:
1. Make everything clickable (cross-entity navigation) — turns tables into intelligence
2. Show revolving door data (already synced, not displayed) — instant differentiator
3. Add AI insight cards — makes the platform feel alive
4. Client context filter — makes intelligence actionable for the user's current work

**Biggest impact for document generation**:
1. Federal Register + Regulations.gov — regulatory context
2. Full Congress bill text + committee referrals — legislative grounding
3. Document Context Pipeline — aggregates all intelligence for AI drafting
4. CRS reports — neutral policy analysis for citation

The intelligence you're already feeding into outreach emails (via `buildFederalContextBlock`)
is a good start. The goal is to expand that to every document the platform generates —
white papers, submissions, memos, talking points — grounded in real federal data, not
AI hallucination.

---

*Capiro, Inc. · capiro.ai · CONFIDENTIAL · May 2026*
