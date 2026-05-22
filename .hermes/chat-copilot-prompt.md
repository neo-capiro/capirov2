# Capiro AI Copilot — Tier 2: Hermes-Powered Chat Drawer

## Feature Summary
Build an AI copilot chat drawer into the Capiro web platform that opens/closes like ChatGPT's side panel (right-side drawer, slides in/out, persistent across page navigation). The bot is context-aware (knows which page the user is on, which client is selected, which engagement/workflow they're viewing), can answer questions about any intelligence data, and can directly edit drafts in Engagement (outreach emails) and Workflows (form fields). Backend uses the existing EngagementAiService pattern (OpenAI + Anthropic with fallback) with a new ChatModule that orchestrates across all existing services.

## Phase 1: API Backend (ChatModule)

### New Files
```
apps/api/src/chat/
├── chat.module.ts
├── chat.controller.ts
├── chat.service.ts          # Orchestrator: intent routing + response generation
├── chat-tools.service.ts    # Tool execution: calls into existing services
└── dto/
    ├── chat-message.dto.ts
    └── chat-context.dto.ts
```

### Database: Chat History Table
Add to Prisma schema:
```prisma
model ChatMessage {
  id          String   @id @default(uuid()) @db.Uuid
  tenantId    String   @map("tenant_id") @db.Uuid
  userId      String   @map("user_id")
  role        String   // 'user' | 'assistant' | 'system'
  content     String   @db.Text
  metadata    Json?    // tool calls, context snapshot, etc.
  sessionId   String   @map("session_id") // groups messages in a conversation
  createdAt   DateTime @default(now()) @map("created_at")

  @@map("chat_message")
  @@index([tenantId, userId, sessionId])
  @@index([createdAt])
}
```

### API Endpoints
```
POST   /api/chat/message          # Send a message, get AI response (streaming SSE)
GET    /api/chat/history          # Get chat history for current session
POST   /api/chat/session          # Start a new session
DELETE /api/chat/session/:id      # Delete a session
POST   /api/chat/edit-draft       # Edit an engagement outreach draft via AI
POST   /api/chat/edit-workflow    # Edit a workflow instance field via AI
```

### Chat Service: Tool/Intent System
The chat service classifies user intent and routes to the right tool:

```typescript
type ChatIntent =
  | 'query_intelligence'      // "What bills affect Raytheon?"
  | 'query_clients'           // "Show me my active clients"
  | 'query_engagement'        // "What meetings do I have this week?"
  | 'query_workflow'          // "What's the status of my NDAA submission?"
  | 'edit_draft'              // "Make this email more formal" / "Add a paragraph about..."
  | 'edit_workflow_field'     // "Change the white paper intro to focus on..."
  | 'generate_draft'          // "Draft a follow-up email to Sen. Cruz's office"
  | 'generate_briefing'       // "Give me a briefing on Lockheed"
  | 'general_question'        // "How does the NDAA process work?"
  | 'navigate'                // "Take me to the intelligence center"
```

### How Draft Editing Works
The frontend sends the current draft content + the user's edit instruction:
```typescript
// POST /api/chat/edit-draft
{
  engagementId: string,     // The outreach/campaign record ID
  recipientId?: string,     // Specific recipient draft to edit
  currentSubject: string,   // Current email subject
  currentBody: string,      // Current email body (markdown)
  instruction: string,      // "Make it shorter" / "Add a CDS section" / "More formal tone"
  context: {                // Auto-injected by frontend
    clientId?: string,
    pageContext: string,    // 'engagement' | 'workspace' etc.
  }
}
// Response:
{
  subject: string,          // Updated subject
  body: string,             // Updated body
  changesSummary: string,   // "Made the tone more formal, shortened paragraph 2..."
}
```

### How Workflow Field Editing Works
```typescript
// POST /api/chat/edit-workflow
{
  instanceId: string,       // Workflow instance ID
  fieldKey: string,         // The step field to edit (e.g. 'whitePaperDraft')
  currentValue: string,     // Current field value
  instruction: string,      // "Add more detail about the PE budget line"
  context: {
    clientId?: string,
    templateSlug: string,
  }
}
// Response:
{
  updatedValue: string,     // New field value
  changesSummary: string,
}
```

### AI Implementation Pattern
Follow the EXACT same pattern as `engagement-ai.service.ts`:
- Use `fetchWithTimeout` for API calls
- Use the Anthropic API directly (NOT Bedrock) — the ANTHROPIC_API_KEY is already configured in ECS
- Support Anthropic as primary, OpenAI as fallback
- Read config from `ConfigService` (ANTHROPIC_API_KEY, OPENAI_API_KEY)
- Use Claude Haiku (claude-3-5-haiku-latest) for intent classification (fast, cheap)
- Use Claude Sonnet (claude-sonnet-4-20250514) for response generation (quality)
- Include federal context from `LobbyIntelService` and `FederalSpendingService` when relevant
- For streaming, use the Anthropic streaming API (content_block_delta events)

### Streaming (SSE)
The `/api/chat/message` endpoint returns Server-Sent Events for streaming:
```typescript
@Sse('message')
// or
@Post('message')
// with response.setHeader('Content-Type', 'text/event-stream')
```

### Auth & Tenant Scoping
Use the EXACT same patterns as other controllers:
- `@UseGuards(RolesGuard)` + `@Roles('standard_user')`
- `@CurrentTenant() ctx: TenantContext`
- All queries scoped by `ctx.tenantId`

### Register in app.module.ts
Add `ChatModule` to imports array.

## Phase 2: Frontend Chat Drawer

### New Files
```
apps/web/src/components/chat/
├── ChatDrawer.tsx           # Main drawer component (slides from right)
├── ChatInput.tsx            # Message input with send button
├── ChatMessage.tsx          # Individual message bubble
├── ChatSession.tsx          # Session list/selector
├── useChatStore.ts          # Zustand or React state for chat
└── chat.css                 # Styles for the drawer
```

### ChatDrawer Behavior (like ChatGPT)
- **Position:** Fixed right side of viewport, overlays content
- **Toggle:** Floating button (bottom-right corner) with Capiro logo/chat icon
- **Open animation:** Slides in from right, ~400px wide on desktop, full-width on mobile
- **Close animation:** Slides out to right
- **Persistent:** Stays open across page navigation (rendered in AppShell, outside <Outlet>)
- **Resize:** Can be dragged wider (optional, nice-to-have)
- **Header:** "Capiro AI" title + close button + new session button
- **Body:** Scrollable message list with auto-scroll to bottom
- **Input:** Fixed bottom text area with send button, supports Enter to send, Shift+Enter for newline
- **Context indicator:** Shows current page context ("Viewing: Engagement > Outreach to Sen. Cruz's Office")

### Context Awareness
The drawer reads the current route and selected client from AppShell state:
```typescript
interface ChatContext {
  page: 'clients' | 'engagement' | 'workspace' | 'intelligence' | 'directory' | 'settings';
  clientId?: string;
  clientName?: string;
  // Engagement-specific
  engagementId?: string;
  meetingId?: string;
  outreachId?: string;
  // Workflow-specific
  workflowInstanceId?: string;
  workflowTemplateSlug?: string;
  // Intelligence
  intelligenceTab?: string;
}
```

### Draft Editing Integration
When the user is on the Engagement page viewing an outreach draft:
1. The chat context includes the engagementId and current draft content
2. User says "make this email shorter" or "add a section about the PE budget"
3. Chat sends POST /api/chat/edit-draft with the current draft + instruction
4. Response includes the updated draft
5. Frontend dispatches a custom event: `window.dispatchEvent(new CustomEvent('capiro:draft-updated', { detail: { engagementId, recipientId, subject, body } }))`
6. The EngagementPage / OutreachWizard listens for this event and updates its local state

### Workflow Field Editing Integration
Same pattern but for workflow instances:
1. Context includes workflowInstanceId and the currently focused field
2. User says "rewrite the white paper introduction"
3. Chat sends POST /api/chat/edit-workflow
4. Response includes updated field value
5. Frontend dispatches `window.dispatchEvent(new CustomEvent('capiro:workflow-field-updated', { detail: { instanceId, fieldKey, updatedValue } }))`
6. WorkflowDrawer listens and updates

### Styling
- Use Ant Design components where possible (Drawer, Input.TextArea, Avatar, Spin)
- Dark header bar (#1a1a2e or match existing nav color)
- Light message area
- User messages: right-aligned, blue/primary color
- Assistant messages: left-aligned, gray/surface color
- Markdown rendering in assistant messages (use existing markdown renderer or `react-markdown`)
- Typing indicator (three dots animation) while waiting for response

### Integration Point: AppShell.tsx
Add the ChatDrawer component inside AppShell, after the Layout:
```tsx
<Layout>
  {/* existing Sider + Content */}
</Layout>
<ChatDrawer context={chatContext} />
```

### State Management
Use React useState in AppShell or a small Zustand store:
```typescript
interface ChatState {
  isOpen: boolean;
  sessionId: string | null;
  messages: ChatMessage[];
  isStreaming: boolean;
  toggle: () => void;
  sendMessage: (content: string, context: ChatContext) => Promise<void>;
  editDraft: (params: EditDraftParams) => Promise<EditDraftResult>;
  editWorkflowField: (params: EditWorkflowFieldParams) => Promise<EditWorkflowFieldResult>;
}
```

## Implementation Notes

### DO NOT use Hermes Agent as a separate ECS service for this phase
The Tier 2 strategy doc described a Hermes ECS service, but for the initial deploy, the smarter path is:
- Build the AI orchestrator INSIDE the existing NestJS API (ChatModule)
- Use the same Bedrock/OpenAI/Anthropic providers already configured
- This avoids: new Docker image, new ECS service, new networking, new auth bridge
- The ChatModule IS the "Hermes brain" — it has tools, memory (chat_message table), and context
- Migration to a true Hermes backend can happen later by swapping ChatService internals

### Existing patterns to follow
- Read `engagement-ai.service.ts` for the AI call pattern
- Read `engagement.controller.ts` for the NestJS controller pattern with auth
- Read `AppShell.tsx` for the layout integration point
- Read `WorkflowDrawer.tsx` for an existing drawer pattern in the codebase
- Read `engagement.module.ts` for module registration pattern
