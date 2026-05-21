# WORKFLOW / STRATEGY DIAGNOSIS & FIX PLAN

## CURRENT FLOW ANALYSIS

### Strategy Wizard (StrategyWizard.tsx — 831 lines)
4-step wizard: Client & Capability → Submissions → Target Members → Review & Create

**What works:**
- Client/capability selection with auto-name generation ✅
- Fiscal year input ✅
- Submission type checkboxes (all 18 templates grouped by category) ✅
- Smart auto-add: NDAA auth → auto-adds HAC-D ✅
- Smart auto-add: any appropriations → auto-adds white paper ✅
- Directory search for target members ✅
- Creates strategy, then creates workflow instances, then creates targets ✅

**What's broken / needs fixing:**

### 1. Submissions → Kanban Triage
When strategy is created, `POST /api/strategies/:id/create-submissions` creates WorkflowInstance records. These ARE created with `status: 'triage'` — so they DO land in triage. ✅ This is working.

However the user reports it doesn't behave as expected. Need to verify the `create-submissions` endpoint actually sets triage status.

### 2. WorkflowDrawer Form Issues (WorkflowDrawer.tsx — 921 lines)

**Currently in the drawer when you open an NDAA Authorization Request card:**

```
Request Type toggle: [Funding Request] [Policy / Bill Language Request]   ← USER WANTS: remove Policy tab

Funding Request TAB fields:
- Title of Request                    ← should suggest a name from AI
- Appropriations Account              ← leave as is
- Subcommittee                        ← should auto-populate from strategy selection
- Program                             ← already populates ✅
- Program Element (PE)                ← should populate from client capability.peNumber
- Line Number                         ← should populate from client capability (not currently stored)
- Your FY2026 Requested Funding Amount ← should populate from capability.fundingAsk
- President's FY2026 Budget Amount    ← should populate from capability (not currently stored)
- FY2025 Enacted Amount               ← leave as is ✅
- Brief explanation justification     ← textarea is fine, add "Enhance with AI" button
- Proposed report or bill language    ← REMOVE (it's in the second tab)
- Language type                       ← REMOVE
- How many requests submitting        ← leave as is
- Priority rank                       ← leave as is
- Connection to state/district        ← leave as is
- Submitted to other offices          ← leave as is

Your Contact Information              ← auto-populate from settings ✅ (already works)
Organization/Entity Contact Info      ← auto-populate from client ✅ (already works)
  - Name of Head of Organization      ← should populate from client profile
Submission Details section            ← REMOVE entirely

Generated Document section            ← When white paper is generated:
  - Remove "Request Type" label
```

### 3. Save / Status Flow
- Save button exists ✅ (auto-saves on 1.5s debounce)
- When saved → move card to "In Progress" in Kanban ← NEEDS TO BE ADDED
- Add "Submit for Approval" button → moves card to "Review" column ← NEEDS TO BE ADDED

---

## CHANGES REQUIRED

### A. WorkflowDrawer — Remove Policy tab for NDAA/Defense templates
For templates in the 'authorization' category, hide the Policy / Bill Language Request tab.
Only show the Funding Request tab. The `requestType` toggle should be hidden when
the template only has a funding section, or when the template is NDAA/defense.

### B. WorkflowDrawer — Auto-populate from capability
When a workflow instance has a `strategyId`, fetch the strategy's capability data and
pre-populate:
- `program_element` ← capability.peNumber
- `requested_funding_amount` ← capability.fundingAsk
- `title_of_request` ← suggest from capability.name + client.name

The capability data is already available via the strategy — need to pass it through.

### C. WorkflowDrawer — Auto-populate subcommittee from strategy
The strategy's selected submission types determine the subcommittee.
E.g., `hac-defense-programmatic` → Subcommittee = "Defense".
Auto-set the `subcommittee` field based on the template slug.

### D. WorkflowDrawer — Remove "Proposed report or bill language" fields
Remove `proposed_language` and `proposed_language_type` from the Funding Request tab
since they're duplicated in the Policy tab.

### E. WorkflowDrawer — Remove "Submission Details" section
Remove the entire Submission Details section (Target Member, Deadline, Method, Notes)
from the drawer. These are managed at the strategy level.

### F. WorkflowDrawer — Add "Enhance with AI" button to justification field
Add a small button next to the `justification` textarea that calls the AI to
enhance/expand the text while preserving the user's intent.

### G. WorkflowDrawer — Add "Submit for Approval" button
Add a button in the drawer footer that:
1. Saves the current form data
2. Changes the workflow instance status to `review`
3. Updates the Kanban board to move the card to "Under Review"

### H. WorkflowDrawer — Auto-move to "In Progress" on first save
When a workflow instance in `triage` status is saved for the first time
(any field changes), automatically transition to `in_progress`.

### I. WorkflowDrawer — Fix generated document view
When viewing a generated white paper:
- Remove the "Request Type" toggle at the top
- Show the document in a cleaner view

### J. Client Profile — Add "Head of Organization" field
Add `headOfOrgName` and `headOfOrgTitle` fields to the client intake data
so they can be pre-populated into the org contact section.
Remove any redundant fields in the client profile page.

### K. Seed Template Updates
Update the NDAA authorization request seed template to:
- Remove `proposed_language` and `proposed_language_type` from the funding section
- Keep them only in the policy section (which will be hidden for defense templates)
