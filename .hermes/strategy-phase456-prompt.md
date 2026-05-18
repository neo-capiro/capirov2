TASK: Phases 4+5+6 — Cross-submission auto-fill, deadline bar, and AI document generation.

## CONTEXT — READ FIRST:
- apps/api/src/strategies/strategies.service.ts (Strategy service with create-submissions)
- apps/api/src/workflows/workflows.service.ts (workflow service with aiFillInstance)
- apps/api/src/engagement/engagement-ai.service.ts (AI service patterns)
- apps/web/src/pages/workspace/WorkspaceLayout.tsx (workspace layout — deadline bar goes here)
- apps/web/src/pages/workspace/StrategyDashboard.tsx (if it exists — dashboard with "Generate" buttons)
- apps/web/src/pages/workspace/WorkflowDrawer.tsx (drawer with AI fill)
- apps/api/prisma/seed-workflows.ts (template contextInfo has deadlines)
- apps/web/src/theme.css

## PHASE 4: Cross-Submission Auto-Fill

### Backend: Update strategies.service.ts createSubmissions method

When createSubmissions creates workflow instances from the strategy's submissionTypes, it should pre-populate formData on each instance using data from the capability profile:

```typescript
// In createSubmissions, after creating the instance:
// 1. Fetch the capability if strategy has capabilityId
// 2. For each instance, pre-fill formData based on template type + capability data

const prefillData: Record<string, unknown> = {};

// From capability:
if (capability) {
  prefillData.program = capability.name;
  prefillData.program_element = capability.peNumber;
  prefillData.appropriation_account = capability.appropriationAccount;
  prefillData.requested_funding_amount = capability.fundingAsk;
  prefillData.justification = capability.justification;
  prefillData.line_number = capability.peNumber; // often same
  // For subcommittee, map from capability.targetSubcommittee
  if (capability.targetSubcommittee) prefillData.subcommittee = capability.targetSubcommittee;
  if (capability.serviceBranch) prefillData.service_branch = capability.serviceBranch;
  if (capability.districtNexus) {
    prefillData.connection_to_massachusetts = true;
    prefillData.massachusetts_connection_detail = capability.districtNexus;
  }
}

// From client:
if (client) {
  prefillData.org_name = client.name;
  // ... other client fields
}
```

Also add a new endpoint:
- POST /api/strategies/:id/sync-data — re-syncs capability data into all linked instances' formData (for when capability is updated after instances were created)

### Frontend: Update WorkflowDrawer.tsx

When opening a drawer for an instance that belongs to a strategy:
- Show a banner: "Part of strategy: {strategy name}" with a link to the dashboard
- "Sync from strategy" button that calls the sync-data endpoint

## PHASE 5: Deadline Bar

### Backend: New endpoint
- GET /api/strategies/deadlines — returns upcoming deadlines across all active strategies

The response should aggregate:
```json
[
  {
    "strategyId": "...",
    "strategyName": "FY27 JaiaBot Hydro",
    "clientName": "Jaia Robotics",
    "templateSlug": "hac-defense-programmatic",
    "templateName": "HAC Defense Programmatic",
    "deadline": "2026-03-20",
    "deadlineLabel": "HAC Defense Programmatic deadline",
    "daysUntil": 5,
    "instanceId": "...",
    "instanceStatus": "in_progress"
  }
]
```

Deadlines come from the template's contextInfo.timing field. Parse deadline dates from it. If no specific date, skip. Sort by soonest first. Only return deadlines within 30 days and for active strategies.

### Frontend: Update WorkspaceLayout.tsx

Add a deadline bar at the top of the workspace (above the tab navigation):

```tsx
// Only shown when there are upcoming deadlines
<div className="deadline-bar">
  <WarningOutlined /> 
  <span>{deadlines.length} deadlines in the next 14 days:</span>
  {deadlines.slice(0, 3).map(d => (
    <span className="deadline-item" key={d.instanceId}>
      {d.templateName} — {d.deadline} ({d.daysUntil} days)
    </span>
  ))}
</div>
```

### CSS:
```css
.deadline-bar {
  background: #FEF3DC;
  border-bottom: 1px solid #F5D68A;
  padding: 8px 24px;
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 12.5px;
  color: #92400E;
  flex-shrink: 0;
}
.deadline-item {
  font-weight: 600;
  background: #FDE68A;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 11.5px;
}
```

## PHASE 6: AI Document Generation for Supporting Docs

### Backend: New endpoint on workflows service
- POST /api/workflows/instances/:id/generate-document — generates a full document draft for supporting doc templates (white paper, meeting letter, leave-behind, follow-up)

This is different from ai-fill (which fills form fields). This generates a full-text document.

Implementation in workflows.service.ts:
```typescript
async generateDocument(tenantId: string, instanceId: string) {
  // 1. Get the instance with template
  // 2. Get the strategy (if linked) with capability
  // 3. Get the client with all context (same as aiFillInstance)
  // 4. Based on template slug, use different generation prompts:
  
  const templatePrompts: Record<string, string> = {
    'program-white-paper': `Generate a 1-2 page program white paper for congressional submission...`,
    'meeting-request-letter': `Generate a formal meeting request letter to a Member of Congress...`,
    'leave-behind-talking-points': `Generate a leave-behind document with key talking points...`,
    'follow-up-letter': `Generate a post-meeting follow-up thank-you letter...`,
  };
  
  // 5. Call Anthropic with the prompt + all context
  // 6. Save the generated text to the instance formData as 'generated_document' field
  // 7. Return the generated text
}
```

The prompt should include:
- Full client profile (name, description, capabilities)
- Capability details (PE, funding, TRL, justification, district nexus)
- Related submission data (if this is a white paper for an NDAA request, pull the NDAA instance's formData)
- Strategy targets (which Members are being targeted)
- Template-specific formatting instructions

### Frontend: Update StrategyDashboard.tsx

For supporting doc submissions (white paper, meeting letter, leave-behind, follow-up):
- Show "Generate" button instead of "Open" when formData is empty
- "Generate" calls POST /api/workflows/instances/:id/generate-document
- Shows loading spinner during generation
- After generation, shows "View & Edit" button
- Clicking "View & Edit" opens the drawer with the generated content in a rich textarea

Also update WorkflowDrawer.tsx:
- If formData has a 'generated_document' field, show it as a formatted document preview
- Add "Regenerate" button
- Add "Copy to clipboard" and "Download as PDF" buttons (PDF can be a future enhancement — for now just copy)

### CSS for document preview:
```css
.generated-doc-preview {
  background: #fff;
  border: 1px solid var(--line-soft, #E4E8F0);
  border-radius: 8px;
  padding: 24px;
  font-size: 13px;
  line-height: 1.7;
  white-space: pre-wrap;
  max-height: 500px;
  overflow-y: auto;
}
.generated-doc-actions {
  display: flex;
  gap: 8px;
  margin-top: 12px;
}
```

## IMPORTANT:
- Phase 4 is critical for the wizard experience — when users create a strategy and batch-create submissions, each form should already have the program/funding/PE data pre-filled
- Phase 5 is a visual urgency cue — lobbyists live by deadlines
- Phase 6 is where the AI really shines — turning structured data into actual documents
- All API calls must be tenant-scoped
- Follow existing patterns exactly
