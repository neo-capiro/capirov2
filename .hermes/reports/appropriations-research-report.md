# House Appropriations Committee Research Report for Capiro

## Prepared for Neo Martinez, CTO — Capiro
## Date: May 16, 2026

---

## EXECUTIVE SUMMARY

This report provides a comprehensive analysis of the House Appropriations Committee (HAC) process, submission types, deadlines, and requirements — with specific recommendations for Capiro's workflow automation platform. The HAC controls all discretionary federal spending (~23% of the federal budget), making it one of the two critical venues (alongside the NDAA authorization process) where government affairs professionals operate.

Capiro already supports NDAA authorization requests. Adding HAC appropriations support would give users coverage of both sides of the congressional funding equation — authorization (telling DoD what to do) and appropriations (giving DoD the money to do it).

---

## SECTION 1: HOW HOUSE APPROPRIATIONS WORKS

### Constitutional Foundation
The Appropriations Committee derives authority from Article I, Section 9, Clause 7 of the U.S. Constitution: "No Money shall be drawn from the Treasury, but in Consequence of Appropriations made by Law."

### Authorization vs. Appropriation — The Two-Step Process
This is critical context for Capiro users:

1. **Authorization** (what Capiro already supports via NDAA): Other committees (like Armed Services) establish, continue, or alter programs. The NDAA *authorizes* the Navy to create a program.

2. **Appropriation** (what this report covers): The Appropriations Committee decides *how much money* each authorized program receives. Without appropriations, an authorized program has no funding.

**Key insight for Capiro**: Most lobbyist firms submit BOTH an authorization request (NDAA) and a parallel appropriations request for the same program. Capiro should make it easy to create paired submissions.

### Committee Structure
- **63 Members** (35R, 28D in current Congress)
- **12 Subcommittees**, each covering a different area of government:

| # | Subcommittee | Key Jurisdiction | Contact Email |
|---|---|---|---|
| 1 | Agriculture, Rural Dev, FDA | USDA, FDA, farm programs | AG.MemberRequests@mail.house.gov |
| 2 | Commerce, Justice, Science | DOJ, NASA, NOAA, NSF, Census | CJS.MemberRequests@mail.house.gov |
| 3 | **Defense** | DoD, Army, Navy, Air Force, Space Force | DE.MemberRequests@mail.house.gov |
| 4 | Energy & Water Development | DOE, Army Corps, NRC | EW.MemberRequests@mail.house.gov |
| 5 | Financial Services & General Gov | Treasury, IRS, OPM, GSA | FS.MemberRequests@mail.house.gov |
| 6 | Homeland Security | DHS, CBP, ICE, FEMA, Coast Guard | HS.MemberRequests@mail.house.gov |
| 7 | Interior, Environment | DOI, EPA, Smithsonian, Forest Service | IN.MemberRequests@mail.house.gov |
| 8 | Labor, HHS, Education | DOL, HHS, NIH, CDC, Dept of Ed | LH.MemberRequests@mail.house.gov |
| 9 | Legislative Branch | Congress, CBO, GPO, Library of Congress | LB.MemberRequests@mail.house.gov |
| 10 | Military Construction, VA | MilCon, VA, Arlington Cemetery | MC.MemberRequests@mail.house.gov |
| 11 | National Security, State Dept | State Dept, USAID, foreign ops | NSRP.MemberRequests@mail.house.gov |
| 12 | Transportation, HUD | DOT, HUD, FAA, Amtrak | TH.MemberRequests@mail.house.gov |

### The Annual Appropriations Process (Timeline)

1. **First Monday in February**: President's Budget Request (PBR) submitted
2. **Late February**: HAC opens electronic submission portal for Member requests
3. **February–March**: Budget and oversight hearings — agency leaders defend funding
4. **March (varies by subcommittee)**: Member submission deadlines (see Section 3)
5. **April–May**: Subcommittee markups — bills drafted within 302(b) allocations
6. **May–July**: Full committee markups and amendments
7. **Summer–Fall**: House floor debate, Senate action, conference
8. **September 30**: End of fiscal year — bills signed or Continuing Resolution passed

### Types of Appropriations Measures

1. **Regular Appropriations**: 12 annual spending bills (the primary vehicle)
2. **Continuing Resolutions (CRs)**: Temporary bridge funding when bills aren't enacted by Oct 1
3. **Supplemental Appropriations**: Additional funding for emergencies/shortfalls mid-year

---

## SECTION 2: SUBMISSION TYPES AND REQUIREMENTS

### Overview
The HAC accepts THREE types of Member requests through its electronic portal (opened February 25, 2026 for FY27):

### 2.1 Programmatic Requests

**What**: A request to fund a specific program or activity at a specified dollar level in the appropriations bill.

**This is the appropriations equivalent of the NDAA authorization request Capiro already supports.**

**Required Information** (based on FY27 guidance and standard practice):
- Member name and contact information
- Subcommittee (must match the program's jurisdiction)
- Account/Program name
- Program Element (PE) or Budget Activity number
- Requested funding level (dollar amount)
- President's Budget Request level for the same line
- Prior year enacted level
- Justification narrative (why the increase is needed)
- Supporting documentation

**Deadlines vary by subcommittee** — see Section 3 below.

### 2.2 Language Requests

**What**: A request to include specific **bill language** or **report language** that does NOT direct funding to a particular entity, but encourages, urges, or directs some type of action.

**Two sub-types**:
- **Bill Language**: Goes into the actual legislative text. Has force of law.
- **Report Language**: Goes into the committee report accompanying the bill. Carries persuasive weight but is not legally binding. Used to express congressional intent, direct studies, require reports, etc.

**Required Information**:
- Member name and contact
- Subcommittee
- Type: Bill Language, Report Language, or both
- Exact proposed language text
- Justification narrative
- Relevant program/agency context

### 2.3 Community Project Funding (CPF) Requests (aka Earmarks)

**What**: Requests to fund specific projects in a Member's district/state. These are the modern version of earmarks, brought back in 2021 with strict transparency rules.

**Key Rules**:
- **Limit**: Maximum 20 projects per Member
- **Federal Nexus Required**: Projects must have a clear connection to federal programs/policies
- **Public Disclosure**: Members MUST post every CPF request on their official websites
- **Financial Disclosure**: Members must certify they have no financial interest
- **Eligible Accounts**: Only certain accounts/programs accept CPF requests (list published by HAC)
- **No For-Profit Recipients**: For most subcommittees, CPF funds cannot go to for-profit entities

**Required Information**:
- Project name and description
- Recipient entity (must be eligible non-profit, government, or educational institution)
- Location (must be in Member's district)
- Dollar amount requested
- Account/subcommittee
- Federal nexus statement
- Member financial disclosure certification
- Community support documentation

**Not applicable for**: Defense, Financial Services, Legislative Branch, National Security/State (these subcommittees do not accept CPF)

---

## SECTION 3: FY27 DEADLINES BY SUBCOMMITTEE

| Subcommittee | Programmatic/Language Deadline | CPF Deadline | CPF Public Posting Deadline |
|---|---|---|---|
| Agriculture/FDA | March 13, 2026, 6:00 PM | March 19, 2026, 6:00 PM | April 3, 2026, 6:00 PM |
| Commerce/Justice/Science | March 13, 2026, 6:00 PM | March 19, 2026, 6:00 PM | March 27, 2026, 6:00 PM |
| **Defense** | **March 20, 2026, 6:00 PM** | **N/A** | N/A |
| Energy & Water | March 20, 2026, 6:00 PM | March 20, 2026, 6:00 PM | April 17, 2026, 6:00 PM |
| Financial Services | March 13, 2026, 6:00 PM | N/A | N/A |
| Homeland Security | March 20, 2026, 6:00 PM | March 20, 2026, 6:00 PM | April 17, 2026, 6:00 PM |
| Interior/Environment | March 20, 2026, 6:00 PM | March 20, 2026, 6:00 PM | April 17, 2026, 6:00 PM |
| Labor/HHS/Education | March 27, 2026, 6:00 PM | March 27, 2026, 6:00 PM | April 17, 2026, 6:00 PM |
| Legislative Branch | March 13, 2026, 6:00 PM | N/A | N/A |
| MilCon/VA | March 13, 2026, 6:00 PM | March 13, 2026, 6:00 PM | March 27, 2026, 6:00 PM |
| National Security/State | March 13, 2026, 6:00 PM | N/A | N/A |
| Transportation/HUD | March 27, 2026, 6:00 PM | March 27, 2026, 6:00 PM | April 17, 2026, 6:00 PM |

---

## SECTION 4: DEFENSE SUBCOMMITTEE — DEEP DIVE

Since Capiro's NDAA features focus on defense, the Defense Appropriations Subcommittee is the most relevant:

### Jurisdiction
- Department of Defense — Military
- Departments of Army, Navy (including Marine Corps), Air Force (including Space Force)
- Office of Secretary of Defense and Defense Agencies
- Central Intelligence Agency
- Intelligence Community Staff

### Defense Programmatic Request Fields (aligns closely with NDAA authorization)
- Program Element (PE) number
- Appropriation account (RDT&E, Procurement, O&M, etc.)
- Budget Activity
- Line Item Number
- President's Budget Request amount
- Requested funding level
- Delta above PBR
- Program description and justification

### Key Difference from NDAA
- NDAA requests go to HASC/SASC members → Armed Services Committee
- Appropriations requests go to HAC Defense Subcommittee members → Appropriations Committee
- **Both are needed** for the same program — authorization without appropriation is meaningless

---

## SECTION 5: FY27 MARKUP SCHEDULE (Current as of May 2026)

The Committee is actively marking up FY27 bills:

| Date | Event |
|---|---|
| May 15, 2026 | House passed MilCon/VA bill (400-15 vote) |
| May 15, 2026 | Energy & Water subcommittee markup |
| May 20, 2026 | Full Committee: Energy & Water + Legislative Branch |
| May 21, 2026 | Subcommittee: Interior + Transportation/HUD |
| June 3, 2026 | Full Committee: Interior |
| June 4, 2026 | Full Committee: Transportation/HUD |
| June 5, 2026 | Subcommittee: Labor/HHS/Ed + Homeland Security |

---

## SECTION 6: FEATURE RECOMMENDATIONS FOR CAPIRO

### Priority 1: Appropriations Request Template (Parallel to NDAA)
**Build an "Appropriations Request" workflow template** — nearly identical to the current NDAA authorization request but targeted at the HAC. This is the #1 value-add because:
- Nearly every NDAA request should have a companion appropriations request
- The fields overlap significantly (PE, account, amounts, justification)
- Add a "Create Companion Appropriations Request" button on the NDAA form
- Auto-populate shared fields from the NDAA request

### Priority 2: Language Request Template
**Build a separate "Report/Bill Language Request" template**:
- Toggle between Bill Language and Report Language
- Text editor for proposed language
- Justification field
- Subcommittee selector
- Reference to existing report language examples (link to prior year reports)

### Priority 3: Community Project Funding (CPF) Template
**Build a CPF workflow** with:
- All required fields (project name, recipient, location, amount, federal nexus)
- Financial disclosure certification checkbox
- Per-member project count tracker (max 20)
- Auto-generate public disclosure text for member website posting
- Eligible account checker (flag if account doesn't accept CPF)

### Priority 4: Deadline Tracker / Calendar
**Add a deadlines module to the workspace**:
- Automatically show upcoming HAC and SASC submission deadlines
- Filter by subcommittee based on client's program area
- Push notifications as deadlines approach
- Calendar view integrated into the engagement manager

### Priority 5: Paired Submission Tracker
**Track authorization + appropriation pairs**:
- Link NDAA requests to their companion appropriations requests
- Show completion status of both sides
- Alert if one side is submitted but not the other
- Dashboard view: "5 NDAA requests submitted, only 3 have companion appropriations"

### Priority 6: Subcommittee Contact Intelligence
**Extend the Congress Directory with HAC-specific data**:
- Which Members sit on which Appropriations subcommittees
- Subcommittee staff contacts (email addresses above)
- Historical voting patterns on relevant bills
- Member's prior CPF requests (publicly available)

### Priority 7: White Paper / One-Pager Generator
**AI-powered document generation**:
- Generate 1-2 page program white papers from the form data
- Format matching congressional submission standards
- Include program description, funding justification, and impact metrics
- Export as PDF for email/print submission

### Priority 8: Submission Portal Integration
**Track portal submissions**:
- The HAC has an electronic submission portal
- While direct API integration may not be possible, Capiro can:
  - Pre-fill data in the correct format for copy/paste into the portal
  - Track submission status (drafted → submitted → acknowledged)
  - Store confirmation/receipt info

### Priority 9: Historical Data & Comparison
**Leverage prior year data**:
- Show FY2026 enacted funding levels as reference
- Compare PBR vs. enacted vs. requested for trend analysis
- AI-powered suggestions based on historical success patterns

### Priority 10: Senate Appropriations Support
**Mirror the House features for the Senate side**:
- The Senate Appropriations Committee (SAC) has a parallel process
- Different deadlines, different subcommittee names, different requirements
- Many firms submit to both chambers simultaneously

---

## SECTION 7: KEY RESOURCES AND LINKS

| Resource | URL |
|---|---|
| HAC Main Site | https://appropriations.house.gov/ |
| FY27 Member Request Guidance | https://appropriations.house.gov/fy27-information/fy27-member-requests-guidance |
| FY27 Community Project Funding | https://appropriations.house.gov/fy27-information/fy27-community-project-funding |
| FY27 Bill Text and Reports | https://appropriations.house.gov/fy27-information/fy27-bill-text-and-reports |
| FY27 Markup Schedule | https://appropriations.house.gov/fy27-information/fy27-markup-schedule |
| FY27 Amendment Tracker | https://appropriations.house.gov/fy27-information/fy27-amendment-tracker |
| Appropriations 101 | https://appropriations.house.gov/about/appropriations-committee-authority-process-and-impact |
| Electronic Submission Portal | Referenced in guidance (link available on guidance page) |
| CPF Eligible Accounts List | Referenced in guidance (link available on guidance page) |
| Financial Disclosure Templates | Referenced in guidance (link available on guidance page) |
| Staff Training Video Tutorial | Referenced in guidance (link available on guidance page) |
| FY2026 CPF Examples | Referenced in guidance (for reference) |

---

## SECTION 8: SUMMARY OF IMMEDIATE ACTION ITEMS

1. **Now**: Build an "Appropriations Programmatic Request" template in the workflow catalog (mirrors NDAA but for HAC). This is the lowest-hanging fruit.

2. **Next**: Add "Language Request" template (bill/report language). Very common submission type.

3. **Soon**: Add deadline tracking with the FY27 dates hardcoded, then make it dynamic for future years.

4. **Medium-term**: Build the "Create Companion Request" feature linking NDAA ↔ Appropriations workflows.

5. **Longer-term**: CPF template, white paper generator, Senate appropriations support.

---

*Report compiled from live research of appropriations.house.gov on May 16, 2026.*
*Prepared by Hermes Agent for Capiro.*
