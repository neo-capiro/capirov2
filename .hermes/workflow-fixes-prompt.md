## WORKFLOW STRATEGY FIXES — Claude Code Prompt

### CONTEXT
Capiro monorepo: NestJS API (apps/api/), React+AntDesign web (apps/web/).
Prisma ORM, PostgreSQL. The workflow system has:
- StrategyWizard.tsx (831 lines) — creates strategies with submission types
- KanbanBoard.tsx (212 lines) — drag-and-drop kanban with triage/in_progress/review/submitted/complete
- WorkflowDrawer.tsx (921 lines) — drawer that opens when clicking a kanban card, shows form fields
- workflowTypes.ts (131 lines) — types and constants
- seed-workflows.ts (801 lines) — 18 workflow templates with form field definitions
- strategies.service.ts (431 lines) — strategy CRUD + create-submissions
- workflows.service.ts (601 lines) — workflow instance CRUD + AI fill + document generation

### READ FIRST (read ALL of these completely before writing any code)
- apps/web/src/pages/workspace/WorkflowDrawer.tsx
- apps/web/src/pages/workspace/KanbanBoard.tsx
- apps/web/src/pages/workspace/workflowTypes.ts
- apps/web/src/pages/workspace/StrategyDashboard.tsx
- apps/api/prisma/seed-workflows.ts (the NDAA authorization request template starting at line 119)
- apps/api/src/strategies/strategies.service.ts
- apps/api/src/workflows/workflows.service.ts
- apps/web/src/pages/clients/clientTypes.ts
- apps/web/src/pages/clients/CapabilityDrawer.tsx

### CHANGES TO IMPLEMENT

#### A. WorkflowDrawer.tsx — Hide Policy tab for authorization/defense templates

The Request Type toggle (Radio.Group at ~line 507) shows "Funding Request" and "Policy / Bill Language Request". For templates with category 'authorization' OR templates whose slug starts with 'hac-defense' or 'ndaa-', HIDE the entire Radio.Group toggle and force requestType to 'funding'. The Policy tab fields are redundant for defense authorization.

Logic: if `template?.category === 'authorization' || template?.slug?.startsWith('hac-defense') || template?.slug?.startsWith('ndaa-')`, don't render the Radio.Group and default requestType to 'funding'.

#### B. WorkflowDrawer.tsx — Auto-populate fields from strategy capability

When a workflow instance has a `strategyId`, the drawer should fetch the strategy (including its capability) and pre-populate form fields from the capability data.

Add a query to fetch the strategy when `instance.strategyId` exists:
```
GET /api/strategies/:strategyId
```
This returns the strategy with `capability` relation which has: `peNumber`, `fundingAsk`, `fundingAskLabel`, `name`.

Then in a useEffect, when strategy data loads, pre-populate these form fields (only if the field is currently empty):
- `program_element` or `program_element` ← `strategy.capability.peNumber`
- `requested_funding_amount` or `requested_funding_amount` ← `strategy.capability.fundingAsk`
- `president_budget_amount` ← leave empty (field doesn't exist on capability yet)
- `title_of_request` ← auto-suggest: `"FY27 ${strategy.capability.name} ${template.category === 'authorization' ? 'Authorization' : 'Appropriations'} Request"`
- `program` ← `strategy.capability.name` (this may already work)

#### C. WorkflowDrawer.tsx — Auto-populate subcommittee from template slug

Map template slugs to subcommittee values:
```typescript
const SLUG_TO_SUBCOMMITTEE: Record<string, string> = {
  'ndaa-authorization-request': 'Defense',  // or let user pick from HASC subcommittees
  'hac-defense-programmatic': 'Defense',
  'hac-agriculture-programmatic': 'Agriculture, Rural Development, FDA',
  'hac-cjs-programmatic': 'Commerce, Justice, Science',
  'hac-energy-water-programmatic': 'Energy and Water Development',
  'hac-fsgg-programmatic': 'Financial Services and General Government',
  'hac-homeland-programmatic': 'Homeland Security',
  'hac-interior-programmatic': 'Interior, Environment',
  'hac-labor-hhs-programmatic': 'Labor, HHS, Education',
  'hac-legbranch-programmatic': 'Legislative Branch',
  'hac-milcon-va-programmatic': 'Military Construction, Veterans Affairs',
  'hac-natsec-state-programmatic': 'National Security, State Department',
  'hac-thud-programmatic': 'Transportation, HUD',
};
```

In the useEffect that runs when instance loads, if `formData.subcommittee` is empty and the template slug is in this map, auto-set it.

#### D. seed-workflows.ts — Remove proposed_language fields from NDAA funding section

In the NDAA authorization request template (slug: 'ndaa-authorization-request'), in the `sections.funding.section1.fields` array, REMOVE:
- The field with key `proposed_language` (line ~145)
- The field with key `proposed_language_type` (line ~146)

These fields should only exist in the `sections.policy.section1` (which the user won't see anyway since we're hiding the Policy tab).

#### E. WorkflowDrawer.tsx — Remove "Submission Details" section

Remove the entire section from ~line 656-718 that contains:
- Target Member input
- Submission Deadline input
- Submission Method select
- Notes textarea

This section is redundant when the workflow is linked to a strategy (which manages targets at the strategy level).

#### F. WorkflowDrawer.tsx — Add "Enhance with AI" button to justification textarea

Find the FieldRenderer component (~line 782). For textarea fields with key `justification` (or any textarea), add a small button below the textarea: "✨ Enhance with AI".

When clicked, call:
```
POST /api/workflows/instances/:id/ai-enhance-field
Body: { fieldKey: 'justification', currentValue: '...' }
```

Create this endpoint in workflows.service.ts — it takes the current text and asks the AI to enhance/expand it while preserving the user's intent. Return `{ enhanced: string }`. Update the field value with the result.

For the API endpoint, add to workflows.service.ts:
```typescript
async enhanceField(id: string, tenantId: string, fieldKey: string, currentValue: string) {
  // Use the existing AI service to enhance the text
  const prompt = `Enhance the following government affairs justification text. Keep the same intent and key points, but make it more professional, specific, and persuasive. Do not invent facts — only improve the writing. Return only the enhanced text, no explanations.\n\nOriginal:\n${currentValue}`;
  // Call AI and return enhanced text
}
```

Add to workflows.controller.ts:
```
POST /api/workflows/instances/:id/ai-enhance-field
```

#### G. WorkflowDrawer.tsx — Auto-move to "In Progress" on first save

In the `saveRef.current` function (~line 195), after the save mutation succeeds, check if the instance was in `triage` status. If so, also update the status to `in_progress`:

```typescript
onSuccess: (updated) => {
  setSaveStatus('saved');
  // Auto-transition from triage to in_progress on first save
  if (instance?.status === 'triage' && updated.status === 'triage') {
    updateInstance.mutate({ status: 'in_progress' });
  }
  onUpdated(updated);
  qc.invalidateQueries({ queryKey: ['workflow-instances'] });
},
```

Actually, better approach: include the status transition in the same save call. In `saveRef.current`, if `instance.status === 'triage'`, add `status: 'in_progress'` to the mutation payload.

#### H. WorkflowDrawer.tsx — Add "Submit for Approval" button

In the drawer footer (~line 379-407), add a "Submit for Approval" button between Save and Delete:

```tsx
<Button
  icon={<CheckOutlined />}
  onClick={() => {
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    updateInstance.mutate({ 
      title, formData, targetMember, submissionDeadline, submissionMethod, notes, 
      clientId: selectedClientId,
      status: 'review' 
    });
  }}
  disabled={instance?.status === 'review' || instance?.status === 'submitted' || instance?.status === 'complete'}
>
  Submit for Approval
</Button>
```

#### I. WorkflowDrawer.tsx — Hide Request Type toggle when viewing generated document

When `formData.generated_document` exists and the template category is 'supporting', hide the Request Type Radio.Group toggle. The user is viewing the output, not switching input modes.

#### J. Client Profile — Add Head of Organization fields

Modify the Client intakeData to support `headOfOrgName` and `headOfOrgTitle`.

In WorkflowDrawer.tsx, update the `getClientFieldValue` function to add:
```typescript
case 'org_head_name': return nonEmpty(intake.headOfOrgName as string | undefined);
case 'org_head_title': return nonEmpty(intake.headOfOrgTitle as string | undefined);
```

In the client form/profile page (ClientFormModal.tsx or ClientProfilePage.tsx), add fields for "Head of Organization Name" and "Head of Organization Title" in the intake data section. Remove any duplicate fields that capture the same info.

### IMPORTANT CONSTRAINTS
- Keep all existing functionality working — don't break the kanban drag-and-drop, auto-save, AI fill, or document generation
- Use Ant Design components matching existing patterns
- The WorkflowDrawer auto-saves on 1.5s debounce — any status changes should go through the same mutation
- All Prisma queries use prisma.withTenant() for RLS
- Import CheckOutlined from @ant-design/icons if not already imported
