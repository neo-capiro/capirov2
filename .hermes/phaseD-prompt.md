TASK: Phase D — AI auto-fill from client documents via LLM.

## CONTEXT
Read these files FIRST:
- apps/api/prisma/schema.prisma (Client model, EngagementAttachment model)
- apps/api/src/workflows/workflows.controller.ts
- apps/api/src/workflows/workflows.service.ts
- apps/web/src/pages/workspace/WorkflowDrawer.tsx (current drawer with client dropdown)
- apps/web/src/pages/workspace/workflowTypes.ts (field definitions)
- apps/web/src/pages/clients/ClientWorkspacePage.tsx (client profile page)
- apps/web/src/pages/clients/clientTypes.ts (ClientAttachment type)
- apps/api/src/engagement/engagement-ai.service.ts (existing AI service — check for LLM call patterns)
- apps/api/src/clio/clio.service.ts (another AI integration example)

## WHAT TO BUILD

### D1. Client Documents — Upload & Storage

The client profile already supports attachments via EngagementAttachment. Check if there's an existing upload endpoint for client documents. If so, use it. If not, add one.

Look at the existing upload patterns in the codebase (S3 presigned URLs, multer, etc.) and follow the same pattern.

We need:
- A way to upload PDFs/docs to a client's profile
- A way to list client documents
- A way to read the text content of uploaded documents (for AI context)

If the existing EngagementAttachment model and upload flow already supports this via clientId, just wire it up. If not, create a simple endpoint:

POST /api/clients/:id/documents — upload file (S3 + store reference)
GET /api/clients/:id/documents — list documents

For text extraction: when a document is uploaded, if it's a PDF or text file, extract the text content and store it. You can:
- For PDF: use a simple approach — store the raw file in S3, and when AI-fill is requested, fetch and send to LLM
- For text: read directly

### D2. AI Auto-Fill Endpoint

Add to the workflows controller:

POST /api/workflows/instances/:id/ai-fill

Body: { clientId: string }

Logic in workflows.service.ts:
1. Fetch the workflow instance (with template)
2. Fetch the client (with intakeData)
3. Fetch client documents/attachments (get text content)
4. Determine which fields can be AI-filled based on the current request_type in formData
5. Build a prompt that includes:
   - The template context info (what the document is, timing, submission details)
   - Client info (name, description, product description, all intakeData)
   - Document text content (truncated to fit context window — max 10000 chars total)
   - The field definitions that need filling (label, helpText, type)
   - Current formData values (so AI can reference what's already filled)
6. Call the Anthropic API (ANTHROPIC_API_KEY is in env/secrets) using fetch or the existing pattern in the codebase
   - Use claude-3-5-haiku-latest for speed/cost
   - Ask it to return JSON: { suggestions: { [fieldKey]: { value: string, reasoning: string } } }
   - Only suggest values for text/textarea fields that are currently empty
7. Return the suggestions to the frontend

Check how apps/api/src/engagement/engagement-ai.service.ts or apps/api/src/clio/clio.service.ts calls the LLM. Follow that exact pattern (SDK vs raw fetch, error handling, etc.).

### D3. Frontend — AI Fill Button in Drawer

In WorkflowDrawer.tsx:
- After client is selected and Section 1 fields are visible, show an "Auto-fill with AI" button
  - Use Ant Design Button with BulbOutlined icon, type="dashed"
  - Only enabled when a client is selected
  - Loading state while API call is in progress
- On click: POST /api/workflows/instances/:id/ai-fill { clientId }
- On response: show a modal or inline review panel with suggestions
  - Each suggestion shows: field label, suggested value, reasoning
  - "Accept" button per field (populates the form field)
  - "Accept All" button
  - "Dismiss" to close without accepting
- After accepting, the auto-save picks up the changes

### D4. CSS for AI fill UI

Add styles for:
- .workflow-drawer-ai-fill — the button container
- .workflow-drawer-ai-suggestions — the suggestions review panel
- .workflow-drawer-ai-suggestion — individual suggestion card
- .workflow-drawer-ai-reasoning — reasoning text (small, secondary)

## IMPORTANT
- Check the existing LLM integration pattern in the codebase FIRST. Use the same SDK/client.
- If the Anthropic SDK is already in package.json, use it. If not, use raw fetch with the API.
- Keep AI suggestions lightweight — only fill text/textarea fields, not selects or booleans.
- Truncate document content to prevent context window overflow.
- Handle errors gracefully (API key missing, rate limit, etc.).
- The AI endpoint should be tenant-scoped (verify tenantId on the instance and client).
