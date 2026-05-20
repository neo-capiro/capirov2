Build a professional, visually rich Intelligence Center frontend for Capiro — a government affairs CRM used by lobbyists.

## Context
The backend has these API endpoints (all at /lda-intel/):
- GET /dashboard — {totalFilings, totalSpending, activeClients, activeLobbyists, issueAreas}
- GET /filings?page=&limit=&year=&issueCode=&clientName=&registrantName= — paginated filings
- GET /clients?search=&issueCode=&state=&page=&limit= — paginated clients
- GET /clients/:id — client detail with filing summary
- GET /registrants?search=&page=&limit= — lobbying firms
- GET /registrants/:id — firm detail
- GET /lobbyists?search=&page=&limit= — lobbyist search
- GET /issues — 79 issue codes ranked by spending
- GET /issues/:code — issue detail with top clients
- GET /entities — government entities ranked by filings
- GET /contributions?year=&registrantName= — contribution search
- GET /trends — quarterly spending trends [{quarter, totalFilings, totalSpending}]
- GET /match/:clientName — fuzzy match to LDA clients
- GET /congress/bills?search=&policyArea=&congress=&page=&limit= — bills
- GET /fec/committees?search= — PACs

Also existing:
- GET /lobby-intel/top-spenders?limit= — curated top clients from OpenLobby
- GET /lobby-intel/issues — issue codes with surge trends
- GET /lobby-intel/trending — trending topics
- GET /federal-spending/contractors?search=&limit= — top contractors
- GET /federal-spending/agencies — federal agencies
- GET /federal-spending/industries — top industries

The app uses React + TypeScript + Ant Design + @ant-design/charts. Auth is via Clerk (@clerk/clerk-react).

## Task 1: Rewrite IntelligenceCenterPage.tsx

Location: `apps/web/src/pages/intelligence/IntelligenceCenterPage.tsx`

READ the existing file first to understand imports, layout patterns, how API calls are made (likely fetch or axios to the API base URL). Match the existing patterns.

Build a PROFESSIONAL dashboard with these sections:

### Hero Stats Row (top of page)
4-5 large stat cards in a horizontal row:
- Total Filings (5yr) with icon
- Total Lobbying Spend with $ formatting
- Active Clients
- Active Lobbyists  
- Issue Areas (79)
Use Ant Design Statistic component with Card wrappers. Use a consistent color scheme.

### Spending Trends (full-width chart)
Area or Line chart showing quarterly spending trends over the last 5 years.
Use @ant-design/charts Area component. Show both totalFilings and totalSpending as dual-axis.
Professional color palette (blues/teals).

### Three-Column Layout below chart:

**Left Column: Top Issue Areas**
Horizontal bar chart or ranked list of top 15 issue codes by spending.
Clickable — clicking an issue code shows a drawer/modal with its top clients.
Use Tag components with color coding for each issue.

**Center Column: Top Spenders Leaderboard**  
Table with columns: Rank, Client Name, Total Spend (formatted $), Filings, Top Issues (as Tags).
Paginated, searchable. Clickable rows expand to show filing history.

**Right Column: Government Targets**
Bar chart showing top 15 government entities by filing count.
E.g., "U.S. Senate (45,231 filings)", "House of Representatives", "DOD", "HHS"

### Lobbying Firms Section
Table of top lobbying firms: Name, Client Count, Total Filings.
Searchable.

### Active Lobbyists Section (collapsible)
Searchable table: Name, Firm(s), Active Years, Covered Positions.

### Recent Filings Feed
Live scrolling feed of the most recent filings. Each card shows:
Client → Firm | Issues (as tags) | Amount | Date
Paginated with "Load More" button.

### Congressional Bills Tracker (new tab or section)
Table of tracked bills: Bill #, Title, Sponsor, Status, Policy Area, Date.
Searchable, filterable by congress (118th/119th) and policy area.

### PAC Money Tracker (new tab or section)
Table of PAC committees: Name, Type, Total Receipts, Total Disbursements.
Searchable.

### Design Requirements:
- Use Ant Design's Tabs component to organize sections (Overview, Filings, Firms, Lobbyists, Congress, PACs)
- Professional dark stat cards (use Card with bodyStyle={{background: '#141414', borderRadius: 12}}) or follow existing page patterns
- Responsive layout using Row/Col
- Loading skeletons (Skeleton component) for async data
- Error states (Result component for errors)
- Format all dollar amounts with $X.XM / $X.XB formatting
- Format large numbers with commas
- Use Empty component when no data
- Color code issue tags consistently
- Include a global search bar at the top

## Task 2: Enhance ClientProfilePage.tsx Federal Intel Tab

Location: `apps/web/src/pages/clients/ClientProfilePage.tsx`

READ the existing file first. There's already a "Federal Intel" tab. Enhance it:

1. At the top, call GET /lda-intel/match/{clientName} to fuzzy-match the Capiro client to LDA data
2. Show a "Match Found" or "No Match" banner
3. If matched, show:
   - Spending timeline (Area chart, yearly)
   - Issue codes they lobby on (Tags)
   - Filing history (compact table)
   - Lobbying firms representing them
   - Lobbyists working for them
   - Government entities they target
   - Competitor section: "Other clients lobbying the same issues"
4. Also show federal contractor data (from /federal-spending/contractors) if matched
5. Show relevant Congressional bills (bills matching client's issue codes)

## Task 3: Charts Utility

If needed, create/update `apps/web/src/components/charts.tsx` with reusable chart wrapper components using @ant-design/charts.

## Visual Design Reference
- Think Bloomberg Terminal meets Ant Design Pro
- Dark stat cards with large white numbers and subtle colored accents
- Clean typography, generous whitespace
- Issue code colors should be consistent throughout (map codes to a color palette)
- Use Ant Design Pro's admin dashboard aesthetic

Do NOT modify any backend files. Do NOT delete any existing code outside the files you're rewriting. READ existing files first to match import patterns and API base URL conventions.
