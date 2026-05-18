# Capiro Workflow Template Catalog - Complete Reference
# All 12 HAC Subcommittees + NDAA Authorization + Linked Workflows

## Prepared for Neo Martinez, CTO - Capiro
## Date: May 16, 2026

---

# HOW TEMPLATES LINK TOGETHER

Every government affairs engagement typically requires a CHAIN of linked documents. Capiro should let users create a "campaign" that auto-generates the full chain:

```
CLIENT PROGRAM
    |
    +-- NDAA Authorization Request (HASC/SASC) -- "Authorize the program"
    |       |
    |       +-- White Paper / One-Pager (supporting doc for NDAA)
    |
    +-- HAC Programmatic Request (Appropriations) -- "Fund the program"
    |       |
    |       +-- White Paper / One-Pager (supporting doc for Approp)
    |       +-- Companion Bill/Report Language Request (optional)
    |
    +-- SAC Programmatic Request (Senate Appropriations) -- "Fund in Senate too"
    |       |
    |       +-- White Paper / One-Pager (supporting doc for Senate)
    |
    +-- Community Project Funding Request (if eligible, non-Defense)
    |       |
    |       +-- Federal Nexus Statement
    |       +-- Financial Disclosure Certification
    |       +-- Community Support Letters
    |
    +-- Outreach Materials
            +-- Meeting Request Letter
            +-- Talking Points / Leave-Behind
            +-- Follow-Up Thank You / Status Update
```

---

# TEMPLATE CATEGORIES

## Category 1: AUTHORIZATION (NDAA / Armed Services)

### Template 1.1: NDAA Authorization Request / Program Plus-Up
**Already built in Capiro** (current Funding Request form)

**Purpose**: Ask HASC/SASC member to authorize increased funding for a defense program in the NDAA.
**Submitted to**: Member's personal office (defense LA)
**Committees**: HASC (House Armed Services), SASC (Senate Armed Services)
**Timing**: Jan-Mar following PBR release

**Data Required to Generate Content**:
- Program Element (PE) number
- Appropriation account (RDT&E, Procurement, O&M, MILCON, MILPERS)
- Budget Activity and Line Item Number
- Current PBR funding level
- Requested authorization level + delta above PBR
- Program description (what it does, current status, operational relevance)
- Subcommittee alignment (Airland, Seapower, Cyber, Strategic Forces, etc.)
- State/district connection (where work is performed)
- Prior year history (enacted levels)

**Data Sources for AI Auto-Fill**:
- Client profile: program description, PE number, funding ask
- Client documents: program briefs, capability statements, past submissions
- DoD budget justification books (public, can be scraped/indexed)
- Prior year NDAA conference reports (for historical language)

### Template 1.2: NDAA Policy / Bill Language Request
**Already built in Capiro** (current Policy form)

**Purpose**: Request specific bill or report language in the NDAA.
**Data Required**: Same contact info + proposed language text, justification, subcommittee

---

## Category 2: HOUSE APPROPRIATIONS (HAC) - All 12 Subcommittees

### UNIVERSAL FIELDS (all HAC programmatic requests share these):

**Section 1 - Request Details**:
| Field | Type | Notes |
|---|---|---|
| Title of Request | text (100 char) | Short descriptive title |
| Subcommittee | select | Must match program jurisdiction |
| Account Name | text | Specific appropriation account |
| Program Name | text | Official program name |
| Program Element / Budget Line | text | PE number or equivalent |
| Requested Funding Amount | integer | Dollar amount, no symbols |
| President's Budget Amount | integer | PBR level (enter 35 if PBR not released) |
| Prior Year Enacted Amount | integer | FY-1 enacted level |
| Justification | textarea | Why the increase is needed |
| Proposed Bill/Report Language | textarea | Optional accompanying language |
| Language Type | select: Report/Bill | If language is provided |
| Number of Requests from Org | integer | Total across all subcommittees |
| Priority Rank | integer | 1 = highest |
| State Connection | boolean + detail | Connection to Member's state/district |
| Submitted to Other Offices | boolean + detail | Which other offices |

**Section 2 - Contact Info** (shared across all):
- Requester: name, phone, email, mailing address, permanent address
- Organization: name, head name/title, address, phone, POC details
- DoD/Agency Contact for the request

---

### Subcommittee 1: Agriculture, Rural Development, FDA

**Jurisdiction**: USDA, FDA, Commodity Futures Trading Commission, Farm Credit Administration
**Contact**: AG.MemberRequests@mail.house.gov
**Deadlines**: Programmatic March 13 | CPF March 19 | CPF public posting April 3
**CPF Eligible**: YES

**Subcommittee-Specific Data for Strong Submissions**:
- USDA program codes and account structures
- FDA product/drug approval pipeline data
- Rural development grant history for the district
- Farm bill program references
- Food safety initiative data
- Agricultural research station details

**CPF Project Types**: Rural water/sewer, food banks, agricultural research facilities, rural broadband, community health centers

**Intel/Perspective Data**:
- USDA budget justification documents
- FDA user fee agreements and budgets
- Rural development loan/grant databases
- Farm Service Agency county data
- National Institute of Food and Agriculture (NIFA) awards

---

### Subcommittee 2: Commerce, Justice, Science (CJS)

**Jurisdiction**: Dept of Commerce, Dept of Justice, NASA, NSF, NOAA, Census Bureau, NIST
**Contact**: CJS.MemberRequests@mail.house.gov
**Deadlines**: Programmatic March 13 | CPF March 19 | CPF public posting March 27
**CPF Eligible**: YES

**Subcommittee-Specific Data**:
- NASA program/mission names and center locations
- NSF directorate and division structure
- DOJ grant programs (COPS, Byrne JAG, VAWA, etc.)
- NOAA program offices and budget structure
- NIST laboratory programs
- Census Bureau operations

**CPF Project Types**: Local law enforcement technology, drug courts, community-based violence prevention, STEM education facilities, weather monitoring equipment

**Intel/Perspective Data**:
- DOJ grant award databases (grants.gov, OJP)
- NASA mission cost estimates and workforce data
- NSF award search database
- NOAA budget blue book
- State crime statistics (for DOJ requests)

---

### Subcommittee 3: Defense

**Jurisdiction**: DoD Military - Army, Navy/Marine Corps, Air Force/Space Force, OSD, CIA, IC Staff
**Contact**: DE.MemberRequests@mail.house.gov
**Deadline**: Programmatic March 20
**CPF Eligible**: NO

**Subcommittee-Specific Data**:
- Program Element (PE) numbers (critical - must be exact)
- Budget Activity codes
- Procurement Line Item Numbers
- Appropriation accounts: RDT&E, Procurement, O&M, MILCON, MILPERS
- FYDP (Future Years Defense Program) data
- Contract vehicle and prime/sub relationships
- Technology Readiness Level (TRL)
- JCIDS documents or capability gap references

**Companion Documents**:
- NDAA Authorization Request (Template 1.1) - ALWAYS paired
- Program White Paper (1-2 pages)
- Capability briefing slides

**Intel/Perspective Data**:
- DoD Comptroller budget justification books (R-1, P-1, O-1, C-1)
- Selected Acquisition Reports (SARs)
- GAO reports on program performance
- CBO cost estimates
- Defense contract award data (FPDS, USAspending.gov)
- Base realignment data (for workforce/economic impact)

**CRITICAL NOTE**: Defense does NOT accept CPF/earmark requests. All defense requests are programmatic or language only.

---

### Subcommittee 4: Energy and Water Development

**Jurisdiction**: DOE, Army Corps of Engineers, Bureau of Reclamation, NRC, Appalachian Regional Commission
**Contact**: EW.MemberRequests@mail.house.gov
**Deadlines**: Programmatic March 20 | CPF March 20 | CPF public posting April 17
**CPF Eligible**: YES

**Subcommittee-Specific Data**:
- DOE program office structure (NNSA, ARPA-E, EERE, Office of Science, etc.)
- Army Corps of Engineers project authorizations and study names
- Bureau of Reclamation project names
- Nuclear Regulatory Commission activities
- National lab locations and programs
- Energy efficiency program codes

**CPF Project Types**: Army Corps flood control/navigation projects, water infrastructure, energy efficiency retrofits, hydropower modernization, environmental remediation

**Intel/Perspective Data**:
- Army Corps Civil Works budget database
- DOE budget request by program
- National lab annual reports
- Bureau of Reclamation water projects list
- State energy plans and renewable energy data

---

### Subcommittee 5: Financial Services and General Government (FSGG)

**Jurisdiction**: Treasury, IRS, OPM, GSA, SBA, SEC, FTC, Judiciary, Executive Office of the President
**Contact**: FS.MemberRequests@mail.house.gov
**Deadline**: Programmatic March 13
**CPF Eligible**: NO

**Subcommittee-Specific Data**:
- IRS program codes and service centers
- SBA program structure (7(a) loans, SBIR/STTR, SBDCs)
- Federal courthouse construction projects
- GSA building projects
- Treasury enforcement programs
- OPM retirement/benefits systems

**Intel/Perspective Data**:
- IRS data books and taxpayer service metrics
- SBA lending statistics by state/district
- Federal real property database (GSA)
- Judiciary space planning reports
- Small business economic data

---

### Subcommittee 6: Homeland Security

**Jurisdiction**: DHS, CBP, ICE, TSA, USCIS, FEMA, Coast Guard, Secret Service, CISA
**Contact**: HS.MemberRequests@mail.house.gov
**Deadlines**: Programmatic March 20 | CPF March 20 | CPF public posting April 17
**CPF Eligible**: YES

**Subcommittee-Specific Data**:
- DHS component budget structures
- FEMA grant programs (UASI, SHSP, Port Security, etc.)
- Coast Guard cutter/asset procurement programs
- CBP technology and infrastructure projects
- TSA screening technology programs
- CISA cybersecurity programs

**CPF Project Types**: Emergency communications equipment, fire station construction, port security enhancements, flood mitigation, cybersecurity infrastructure for local government

**Intel/Perspective Data**:
- FEMA grant award databases
- Coast Guard asset condition reports
- CBP staffing and technology deployment data
- DHS budget overview documents
- State/local emergency preparedness assessments

---

### Subcommittee 7: Interior, Environment

**Jurisdiction**: DOI (NPS, BLM, FWS, BIA, USGS), EPA, Forest Service, Smithsonian, Indian Health Service
**Contact**: IN.MemberRequests@mail.house.gov
**Deadlines**: Programmatic March 20 | CPF March 20 | CPF public posting April 17
**CPF Eligible**: YES

**Subcommittee-Specific Data**:
- National Park Service unit codes and deferred maintenance data
- EPA program structure (Clean Air, Clean Water, Superfund, etc.)
- Forest Service region/forest designations
- Bureau of Indian Affairs programs
- USGS science programs
- Land and Water Conservation Fund projects

**CPF Project Types**: Land conservation, water quality improvement, tribal infrastructure, National Park improvements, Superfund cleanup, wildfire prevention

**Intel/Perspective Data**:
- NPS deferred maintenance list
- EPA enforcement and compliance data
- Superfund site status reports
- BIA budget justification
- State environmental quality reports

---

### Subcommittee 8: Labor, Health and Human Services, Education (LHHS)

**Jurisdiction**: DOL, HHS (NIH, CDC, CMS, HRSA, SAMHSA, ACF), Dept of Education
**Contact**: LH.MemberRequests@mail.house.gov
**Deadlines**: Programmatic March 27 | CPF March 27 | CPF public posting April 17
**CPF Eligible**: YES

**Subcommittee-Specific Data**:
- NIH institute/center structure and funding mechanisms (R01, P01, U01, etc.)
- CDC program codes
- HRSA health center and workforce programs
- SAMHSA grant programs
- Department of Education formula and competitive grant programs
- DOL training and employment programs (WIOA, Job Corps, etc.)

**CPF Project Types**: Community health centers, mental health facilities, substance abuse treatment, workforce training centers, early childhood education, biomedical research equipment

**Intel/Perspective Data**:
- NIH RePORTER (funded research database)
- CDC WONDER (public health data)
- HRSA data warehouse
- Education Department grant award databases
- State health rankings and disparities data
- Substance abuse treatment facility locator

---

### Subcommittee 9: Legislative Branch

**Jurisdiction**: Congress, CBO, GAO, GPO, Library of Congress, Capitol Police, Architect of the Capitol
**Contact**: LB.MemberRequests@mail.house.gov
**Deadline**: Programmatic March 13
**CPF Eligible**: NO

**Note**: This subcommittee deals with internal congressional operations. Lobbyist clients rarely have requests here. Typically only relevant for library/archive programs or congressional research services.

---

### Subcommittee 10: Military Construction, Veterans Affairs (MilCon/VA)

**Jurisdiction**: Military construction projects, VA healthcare/benefits/cemeteries, Arlington National Cemetery, Armed Forces Retirement Home
**Contact**: MC.MemberRequests@mail.house.gov
**Deadlines**: Programmatic March 13 | CPF March 13 | CPF public posting March 27
**CPF Eligible**: YES

**Subcommittee-Specific Data**:
- Military installation names and BRAC status
- MILCON project numbers and FYDP data
- VA medical center and clinic locations
- VA IT modernization programs
- Veterans Benefits Administration programs
- National Cemetery Administration data

**CPF Project Types**: Veterans service facilities, veteran housing, VA clinic improvements, military family support centers

**Companion to Defense**: Defense handles military operations/procurement; MilCon handles facilities and VA. A defense contractor may need requests to BOTH subcommittees.

**Intel/Perspective Data**:
- DoD MILCON budget justification (C-1 book)
- VA budget submission documents
- VA facility condition assessments
- Military installation economic impact studies
- Veterans population data by state/district

---

### Subcommittee 11: National Security, Department of State (formerly SFOPS)

**Jurisdiction**: State Department, USAID, Peace Corps, Millennium Challenge Corporation, international organizations (UN, World Bank, IMF contributions)
**Contact**: NSRP.MemberRequests@mail.house.gov
**Deadline**: Programmatic March 13
**CPF Eligible**: NO

**Subcommittee-Specific Data**:
- State Department bureau structure
- USAID operating unit codes
- Foreign assistance account structure (ESF, FMF, INCLE, NADR, etc.)
- International organization contribution levels
- Embassy security programs
- Global health initiative programs (PEPFAR, PMI, etc.)

**Intel/Perspective Data**:
- Foreign assistance dashboard (foreignassistance.gov)
- State Department congressional budget justification
- USAID country strategy documents
- Global health funding tracker
- International affairs budget crosswalk

---

### Subcommittee 12: Transportation, Housing and Urban Development (THUD)

**Jurisdiction**: DOT (FAA, FHWA, FTA, FRA, MARAD), HUD, National Transportation Safety Board
**Contact**: TH.MemberRequests@mail.house.gov
**Deadlines**: Programmatic March 27 | CPF March 27 | CPF public posting April 17
**CPF Eligible**: YES

**CPF-Specific Programs within THUD**:
- Airport Improvement Program (AIP)
- Highway Infrastructure Projects
- Consolidated Rail Infrastructure and Safety Improvements (CRISI)
- Transit Infrastructure Grants
- Port Infrastructure Development Program
- HUD Economic Development Initiatives

**Subcommittee-Specific Data**:
- FAA airport codes and AIP grant history
- FHWA project numbers and STIP references
- FTA transit agency profiles
- FRA rail corridor data
- HUD program codes (CDBG, HOME, Section 8, etc.)
- Port volume and infrastructure condition data

**Intel/Perspective Data**:
- DOT grant award databases
- FAA airport master plans
- State DOT STIP/TIP documents
- HUD annual reports and performance data
- Transit asset management plans
- Port authority capital plans

---

## Category 3: SUPPORTING DOCUMENTS

### Template 3.1: Program White Paper / One-Pager

**Purpose**: 1-2 page document accompanying any programmatic or authorization request. Most congressional offices require this format.

**Data Required**:
- Program name and managing agency
- Problem statement (what capability gap or need exists)
- Solution description (what the program does)
- Current status and milestones achieved
- Funding history (3-year table: PBR, enacted, requested)
- Economic/workforce impact (jobs, states, small business %)
- Key performance metrics
- Contact information

**Can be auto-generated from**: Client profile + program data + Capiro AI

---

### Template 3.2: Meeting Request Letter

**Purpose**: Formal letter requesting a meeting with a Member or staffer to discuss a specific program/request.

**Data Required**:
- Recipient (Member name, title, office address)
- Requesting organization name and representative
- Purpose of meeting (1-2 sentences)
- Specific request reference (which submission this relates to)
- Preferred dates/times
- Attendee list

---

### Template 3.3: Leave-Behind / Talking Points

**Purpose**: Document left with staff after an in-person meeting. Summarizes the ask and key supporting points.

**Data Required**:
- "The Ask" (1 sentence: what you want them to do)
- 3-5 key supporting points
- Funding comparison table
- District/state impact
- Contact information for follow-up

---

### Template 3.4: Follow-Up Thank You / Status Letter

**Purpose**: Post-meeting follow-up thanking staff and reiterating the ask.

**Data Required**:
- Meeting date and attendees
- Summary of discussion
- Restatement of ask
- Any additional information promised during meeting
- Timeline/deadline reminders

---

### Template 3.5: Federal Nexus Statement (CPF only)

**Purpose**: Required certification that a Community Project Funding request has a clear connection to federal programs and policies.

**Data Required**:
- Project description
- Federal program it connects to
- How the project advances federal policy objectives
- Applicable federal statutes or regulations
- Prior federal investment in the area

---

### Template 3.6: Financial Disclosure Certification (CPF only)

**Purpose**: Required Member certification of no personal financial interest in the project.

**Data Required**:
- Member name
- Project name
- Certification statement
- Signature

---

## Category 4: INTELLIGENCE / RESEARCH DOCUMENTS

### Template 4.1: Program Landscape Brief

**Purpose**: Research document that maps a program's position in the budget landscape. Helps users understand where their client's program sits before submitting requests.

**Data Required**:
- Program name and PE/account
- Historical funding (5-year trend)
- Committee/subcommittee jurisdiction mapping
- Related programs (competitors for same dollars)
- Key congressional champions and opponents
- GAO/CBO reports on the program
- Recent legislative history

### Template 4.2: Member Engagement Profile

**Purpose**: Dossier on a specific Member of Congress relevant to the client's program.

**Data Required** (from LegiStorm/Congress Directory + engagement data):
- Member name, party, state, district
- Committee and subcommittee assignments
- Relevant caucus memberships
- Prior votes on related bills
- Prior appropriations/authorization requests supported
- Staff contacts (defense LA, appropriations LA)
- District interests and economic drivers
- Campaign contribution data (from public FEC records)
- Prior meeting history (from Capiro engagement manager)
- Email/correspondence history (from Capiro engagement manager)

---

# DATA REQUIREMENTS SUMMARY

For each template, Capiro needs these data sources:

| Data Source | Where It Lives | Status |
|---|---|---|
| Client profile (name, description, contacts) | Capiro DB | AVAILABLE |
| Client documents (briefs, past submissions) | Capiro S3/attachments | AVAILABLE |
| Client intakeData (PE, funding ask, sector) | Capiro DB | AVAILABLE |
| Congress Directory (members, staff) | LegiStorm API | AVAILABLE |
| Engagement history (meetings, emails) | Capiro DB | AVAILABLE |
| Clio AI notes | Capiro DB | AVAILABLE |
| DoD budget justification books | Public PDFs (comptroller.defense.gov) | FUTURE: index/scrape |
| Agency budget documents | Public (each agency) | FUTURE: index/scrape |
| USAspending.gov contract data | Public API | FUTURE: integrate |
| Grants.gov award data | Public API | FUTURE: integrate |
| GAO/CBO reports | Public | FUTURE: index |
| Prior year enacted levels | HAC bill text/reports | FUTURE: parse |
| FY27 markup results | HAC amendment tracker | FUTURE: monitor |

---

# RECOMMENDED IMPLEMENTATION ORDER FOR CAPIRO

1. **Immediate**: Add "Appropriations Programmatic Request" template (mirrors NDAA form, different subcommittee list)
2. **Immediate**: Add "Language Request" template (simpler form, bill vs report toggle)
3. **Week 2**: Add "White Paper Generator" template (AI-generated from form data)
4. **Week 2**: Add "Create Companion" button linking NDAA <-> Appropriations workflows
5. **Week 3**: Add CPF template (for the 8 eligible subcommittees)
6. **Week 3**: Add deadline tracker with all 12 subcommittee dates
7. **Week 4**: Add Meeting Request Letter and Leave-Behind templates
8. **Month 2**: Add Program Landscape Brief (requires external data integration)
9. **Month 2**: Add Member Engagement Profile (combines LegiStorm + Capiro data)
10. **Month 3**: Integrate USAspending.gov and budget justification data for AI context

---

*Report compiled from research of appropriations.house.gov, congressional appropriations practice, and government affairs industry knowledge.*
*Prepared by Hermes Agent for Capiro - May 16, 2026*
