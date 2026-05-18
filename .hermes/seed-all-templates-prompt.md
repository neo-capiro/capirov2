TASK: Add all workflow templates to the Library catalog — full seed + frontend categories.

## CONTEXT
Read these files FIRST:
- apps/api/prisma/seed-workflows.ts (current seed — has 1 template: NDAA Authorization Request)
- apps/web/src/pages/workspace/CatalogView.tsx (current catalog grid)
- apps/web/src/pages/workspace/workflowTypes.ts (type definitions)
- apps/web/src/pages/workspace/WorkflowDrawer.tsx (understands requiredSections structure)
- .hermes/reports/capiro-full-template-catalog.md (the research document with all template specs)

## WHAT TO BUILD

### 1. Rewrite seed-workflows.ts with ALL templates

Keep the existing NDAA Authorization Request template exactly as-is (slug: ndaa-authorization-request). ADD these new templates using the SAME requiredSections structure (requestTypes + sections with section1 fields + shared contact). The shared contact sections are IDENTICAL across all templates — extract them as a const and reuse.

**IMPORTANT**: Each template's section1 fields should be specific to that template type. Don't just copy the NDAA fields — tailor them. But the STRUCTURE (requestTypes, sections.funding/policy, shared.requesterContact, shared.orgContact) stays the same pattern so the drawer renders them generically.

Templates to add (grouped by category):

**Category: "authorization" (sortOrder 1-10)**
1. ndaa-authorization-request (EXISTS — keep as-is, sortOrder 1)

**Category: "appropriations" (sortOrder 11-30)**
2. slug: "hac-defense-programmatic" — HAC Defense Programmatic Request
   - Description: "Programmatic funding request to the House Appropriations Defense Subcommittee. Companion to NDAA authorization requests. Covers DoD, Army, Navy, Air Force, Space Force."
   - requestTypes: ['programmatic'] (no CPF for defense)
   - Fields: title, account name, program, PE/budget line, requested amount, PBR amount, prior year enacted, justification, proposed language (optional), language type, num requests, priority rank, state connection (boolean+detail), other offices (boolean+detail)
   - sortOrder: 11

3. slug: "hac-agriculture-programmatic" — HAC Agriculture Programmatic/CPF Request
   - Description: "Programmatic or Community Project Funding request to the Agriculture, Rural Development, FDA Subcommittee. Covers USDA, FDA, farm programs, rural development."
   - requestTypes: ['programmatic', 'cpf']
   - Programmatic fields: same structure as defense
   - CPF fields: project name, project description, recipient entity name, recipient type (select: non-profit/govt/educational), project location (address), requested amount, account (text), federal nexus statement (textarea), community support description (textarea), member financial disclosure (boolean checkbox)
   - sortOrder: 12

4. slug: "hac-cjs-programmatic" — HAC Commerce, Justice, Science Request
   - Description: "Request to the Commerce, Justice, Science Subcommittee. Covers DOJ, NASA, NSF, NOAA, NIST, Census Bureau."
   - requestTypes: ['programmatic', 'cpf']
   - sortOrder: 13

5. slug: "hac-energy-water-programmatic" — HAC Energy & Water Request
   - Description: "Request to the Energy and Water Development Subcommittee. Covers DOE, Army Corps of Engineers, NRC, Bureau of Reclamation."
   - requestTypes: ['programmatic', 'cpf']
   - sortOrder: 14

6. slug: "hac-fsgg-programmatic" — HAC Financial Services Request
   - Description: "Programmatic request to the Financial Services and General Government Subcommittee. Covers Treasury, IRS, SBA, GSA, Judiciary. No CPF."
   - requestTypes: ['programmatic'] (no CPF)
   - sortOrder: 15

7. slug: "hac-homeland-programmatic" — HAC Homeland Security Request
   - Description: "Request to the Homeland Security Subcommittee. Covers DHS, CBP, ICE, TSA, FEMA, Coast Guard, CISA."
   - requestTypes: ['programmatic', 'cpf']
   - sortOrder: 16

8. slug: "hac-interior-programmatic" — HAC Interior & Environment Request
   - Description: "Request to the Interior, Environment Subcommittee. Covers DOI, EPA, Forest Service, Smithsonian, Indian Health Service."
   - requestTypes: ['programmatic', 'cpf']
   - sortOrder: 17

9. slug: "hac-labor-hhs-programmatic" — HAC Labor, HHS, Education Request
   - Description: "Request to the Labor, HHS, Education Subcommittee. Covers DOL, HHS, NIH, CDC, Department of Education."
   - requestTypes: ['programmatic', 'cpf']
   - sortOrder: 18

10. slug: "hac-legbranch-programmatic" — HAC Legislative Branch Request
    - Description: "Programmatic request to the Legislative Branch Subcommittee. Covers Congress, CBO, GAO, GPO, Library of Congress. No CPF."
    - requestTypes: ['programmatic'] (no CPF)
    - sortOrder: 19

11. slug: "hac-milcon-va-programmatic" — HAC MilCon/VA Request
    - Description: "Request to the Military Construction, Veterans Affairs Subcommittee. Covers military construction, VA healthcare/benefits."
    - requestTypes: ['programmatic', 'cpf']
    - sortOrder: 20

12. slug: "hac-natsec-state-programmatic" — HAC National Security/State Request
    - Description: "Programmatic request to the National Security, State Department Subcommittee. Covers State Dept, USAID, foreign operations. No CPF."
    - requestTypes: ['programmatic'] (no CPF)
    - sortOrder: 21

13. slug: "hac-thud-programmatic" — HAC Transportation/HUD Request
    - Description: "Request to the Transportation, HUD Subcommittee. Covers DOT, FAA, FTA, FRA, HUD. CPF available for airport, highway, rail, transit, port, and HUD projects."
    - requestTypes: ['programmatic', 'cpf']
    - CPF fields should include a "CPF Program" select with options: Airport Improvement Program, Highway Infrastructure Projects, CRISI (Rail), Transit Infrastructure Grants, Port Infrastructure Development, HUD Economic Development Initiatives
    - sortOrder: 22

**Category: "language" (sortOrder 31-32)**
14. slug: "hac-language-request" — HAC Bill/Report Language Request
    - Description: "Request to include specific bill or report language in an appropriations bill. Does not direct funding to a particular entity but encourages, urges, or directs agency action."
    - requestTypes: ['bill_language', 'report_language', 'both']
    - Fields: title, purpose type (select: Bill Language/Report Language/Both), subcommittee (select: all 12), program, proposed bill language (textarea), proposed report language (textarea), justification, num requests, priority rank, state connection, other offices
    - sortOrder: 31

**Category: "supporting" (sortOrder 41-44)**
15. slug: "program-white-paper" — Program White Paper / One-Pager
    - Description: "1-2 page white paper accompanying any programmatic or authorization request. Required by most congressional offices."
    - requestTypes: ['white_paper']
    - Fields: program name, managing agency, problem statement (textarea), solution description (textarea), current status and milestones (textarea), funding history table fields (fy_minus2_enacted, fy_minus1_enacted, fy_current_pbr, fy_requested), economic impact (textarea, jobs/states/small business %), key performance metrics (textarea)
    - sortOrder: 41

16. slug: "meeting-request-letter" — Meeting Request Letter
    - Description: "Formal letter requesting a meeting with a Member of Congress or staffer to discuss a program or submission."
    - requestTypes: ['meeting_request']
    - Fields: recipient member name, recipient title, purpose of meeting (textarea), specific request reference, preferred dates (text), attendee list (textarea)
    - sortOrder: 42

17. slug: "leave-behind-talking-points" — Leave-Behind / Talking Points
    - Description: "Document left with congressional staff after a meeting. Summarizes the ask and key supporting arguments."
    - requestTypes: ['talking_points']
    - Fields: the_ask (textarea, "one sentence: what you want them to do"), key_point_1 through key_point_5 (textarea each), district_impact (textarea), funding_comparison_note (textarea)
    - sortOrder: 43

18. slug: "follow-up-letter" — Follow-Up / Thank You Letter
    - Description: "Post-meeting follow-up letter thanking staff and reiterating the ask."
    - requestTypes: ['follow_up']
    - Fields: meeting_date (text), attendees (textarea), discussion_summary (textarea), restatement_of_ask (textarea), additional_info_promised (textarea), deadline_reminders (textarea)
    - sortOrder: 44

### IMPORTANT IMPLEMENTATION NOTES:

1. For templates with ONLY ONE request type (like 'programmatic' only), the drawer should NOT show a request type toggle. Put the fields directly under sections.programmatic.section1. The drawer already reads from sections[requestType] — when there's only one type, default to it.

2. For CPF-eligible templates, the 'cpf' request type should have CPF-specific fields (project name, recipient, location, federal nexus, financial disclosure). The 'programmatic' type has the standard funding request fields.

3. ALL templates share the same shared.requesterContact and shared.orgContact sections — extract these as constants and reuse them. For non-defense templates, change "Department of Defense Contact" to "Agency Contact for Request" in the org contact.

4. Each template's contextInfo should include:
   - overview: what this template is for
   - timing: relevant deadlines (use the FY27 dates from the research)
   - submission: how/where to submit
   - contact_email: the subcommittee email (e.g., DE.MemberRequests@mail.house.gov)

5. The seed should use a loop with upsert for each template — don't write 18 separate upsert blocks. Define templates as an array of objects and iterate.

### 2. Update CatalogView.tsx

The catalog currently shows a flat grid. Update it to:
- Group templates by category with section headers
- Categories: "Authorization (NDAA)", "House Appropriations", "Language Requests", "Supporting Documents"
- Each category is a collapsible section (use Ant Design Collapse or just headers with dividers)
- Show the description truncated to 2 lines on cards
- Add a small badge/tag showing the category
- Keep the "Add to Workflows" button

### 3. Update workflowTypes.ts if needed

The WorkflowTemplate interface should already work — it has requiredSections as any/Record. Just make sure the category field is typed as a union if helpful.

### 4. Update theme.css

Add styles for:
- .catalog-category — category section with header
- .catalog-category-title — section header text
- .catalog-card-badge — category badge on cards

DO NOT touch WorkflowDrawer.tsx — it already renders fields generically from the template JSON. The new templates will just work because they follow the same structure.
