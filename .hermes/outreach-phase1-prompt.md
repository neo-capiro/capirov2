## OUTREACH REDESIGN — Phase 1: Template System + Recipient Multi-Select + Intelligence Step

### CONTEXT
This is a NestJS + React (Ant Design) monorepo. API is at apps/api/, Web at apps/web/.
Prisma ORM with PostgreSQL. The engagement module handles outreach campaigns.

The existing OutreachView.tsx is 4,870 lines — a monolithic wizard component.
The existing engagement-ai.service.ts handles AI email generation.

### WHAT TO READ FIRST
Before writing ANY code, read these files completely:
- apps/web/src/pages/engagement/OutreachView.tsx (the full file — understand the wizard flow, state, all 4 outreach types)
- apps/api/src/engagement/engagement-ai.service.ts (AI generation — prompts, templates, federal context)
- apps/api/src/engagement/engagement.service.ts (CRUD for outreach records)
- apps/api/src/engagement/engagement.controller.ts (API routes)
- apps/web/src/pages/engagement/CampaignsView.tsx
- apps/web/src/pages/engagement/EngagementPage.tsx
- prisma/schema.prisma (search for Outreach, OutreachTemplate models — may not exist yet)

### CHANGES REQUIRED

#### A. DATABASE: Add outreach_template table

Add to prisma/schema.prisma:

```prisma
model OutreachTemplate {
  id        String   @id @default(uuid())
  tenantId  String   @map("tenant_id")
  userId    String?  @map("user_id")  // null = system template, non-null = user-created
  name      String
  category  String   @default("general")  // general, follow_up, meeting, policy, custom
  prompt    String   @db.Text  // natural language prompt instruction
  description String? @db.Text
  samplePreview String? @db.Text @map("sample_preview")  // first few lines of expected output
  tone      String   @default("professional")  // professional, friendly, formal, concise
  metadata  Json?
  usageCount Int     @default(0) @map("usage_count")
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  @@map("outreach_template")
}
```

Generate migration: `npx prisma migrate dev --create-only --name outreach_templates`
Then INSPECT the migration SQL — trim to only the new table (Prisma may try to drop/recreate FKs).

Seed 8 system templates with the prompts below (userId = null, tenantId = 'SYSTEM'):

1. **thank_you**: "Write a brief, warm thank-you email acknowledging a specific recent action or support from the recipient. Name what you're thanking them for using the meeting or engagement context. No new asks. Close with an offer to stay in touch. Under 150 words."

2. **follow_up**: "Write a polite follow-up email referencing a specific prior meeting or conversation. Restate one clear ask or next step. Propose a concrete next action with a suggested timeline. Reference any open commitments from the prior engagement. Under 200 words."

3. **memo**: "Write a concise position memo. Structure: one-line summary at top, then Background (2-3 sentences), The Ask (1 sentence, specific), Supporting Points (3-4 bullets with evidence), and District/State Impact (if available). Under 400 words. Formal but accessible tone."

4. **post_meeting_memo**: (keep the existing POST_MEETING_MEMO_GUIDANCE from engagement-ai.service.ts — it's already good)

5. **introduction**: "Write an introductory outreach email on behalf of a client to a congressional office. Briefly introduce who the client is and why they matter to the recipient's portfolio. Connect the client's work to the recipient's committee jurisdiction or district interests. End with a low-friction first ask — a 15-minute introductory call or brief meeting. Under 200 words."

6. **meeting_request**: "Write a concise meeting request email. State the purpose of the meeting in one sentence. Suggest 2-3 scheduling windows. List who would attend from the client side. Include a one-sentence agenda. Under 150 words."

7. **status_update**: "Write a brief progress update email. List 2-4 short bullets covering: activity since last contact, current program status, and next planned milestone. Only include a new ask if directly tied to the update. Under 200 words."

8. **policy_alert**: "Write a policy alert email informing the recipient of a relevant development. Open with the news (bill movement, funding change, regulatory action). Explain the impact on the recipient's jurisdiction or the client's program. Suggest a follow-up conversation if appropriate. Under 250 words."

#### B. API: Template CRUD endpoints

Add to engagement.controller.ts:
- GET /api/engagement/outreach/templates — list all templates (system + user's custom)
- POST /api/engagement/outreach/templates — create custom template (user-scoped)
- PUT /api/engagement/outreach/templates/:id — update custom template (only own)
- DELETE /api/engagement/outreach/templates/:id — delete custom template (only own)
- GET /api/engagement/outreach/templates/:id/preview — generate a sample email from the template

Add to engagement.service.ts the corresponding service methods.
IMPORTANT: Use prisma.withTenant() for all queries (RLS requirement).

#### C. API: Intelligence Insights endpoint

Add to engagement.controller.ts:
- GET /api/engagement/outreach/insights?clientId=X — returns:
  - surgingIssues: top 6 surging LDA issue areas
  - trendingTopics: top 8 trending terms
  - clientSpending: matched contractor spending data
  - recentBills: relevant congressional bills (from congress_bill table)
  - clientLdaHistory: client's LDA filing summary
  - suggestedTalkingPoints: null (generated on demand)
- POST /api/engagement/outreach/insights/talking-points — AI generates 3-5 talking points from selected insights + client context

This mostly wraps existing methods from lobbyIntel.getAiContext() and federalSpending.getAiContext() but exposes them to the frontend.

#### D. API: Per-recipient email generation

Modify the outreach draft generation to support batch:
- POST /api/engagement/outreach/generate-batch — accepts:
  ```json
  {
    "campaignId": "...",
    "clientId": "...",
    "templateId": "...",
    "recipients": [...],
    "insights": [...],  // selected insight IDs/text
    "additionalContext": "...",
    "tone": "professional"
  }
  ```
  Returns array of { recipientId, subject, body } — one per recipient.
  Each email is generated separately with that recipient's specific context:
  - Their congressional profile (committee, district, title)
  - Their email history with the client (from mail_thread/mail_message tables if available)
  - Their meeting history (from meeting/meeting_debrief tables if available)
  - The selected intelligence insights
  - The template prompt as the generation instruction

#### E. FRONTEND: Rewrite OutreachView wizard

Split OutreachView.tsx into separate components:
- OutreachWizard.tsx — orchestrator with step state
- steps/CampaignSetup.tsx — Step 1: name, client, type
- steps/RecipientSelect.tsx — Step 2: multi-select with tabs
- steps/IntelligenceInsights.tsx — Step 3: insight cards with toggles
- steps/TemplateSelect.tsx — Step 4: template cards with preview
- steps/GenerateReview.tsx — Step 5: per-recipient generation with sidebar
- steps/EmailEditor.tsx — Step 6: rich text editor (use @tiptap/react)
- steps/SendSchedule.tsx — Step 7: send/schedule

Key UI requirements:
1. **RecipientSelect**: Ant Design Table with checkbox selection. Columns: Name, Office, Committee, State, Party, Last Contact. Filter bar at top. Tabs: "Congressional Directory" | "From Meetings" | "Manual Add". Multi-select checkboxes. Selected count badge. "Select entire committee" button that adds all members of a committee.

2. **IntelligenceInsights**: Card layout. Each insight is a card with a toggle switch (include/exclude). Categories: "Lobbying Trends", "Federal Spending", "Legislative Activity". A text area at bottom for custom intelligence notes. "Suggest Talking Points" button that calls the API.

3. **TemplateSelect**: Grid of template cards (not a dropdown). Each card shows: name, category badge, first 3 lines of the prompt, usage count, "Preview" button. System templates have a lock icon. User templates have edit/delete. "Create Custom Template" card with a + icon opens a modal: name field, prompt textarea (with guidance text "Write instructions for the AI as if you're briefing a colleague"), save button. On the same screen below the template grid: "Additional Context" textarea.

4. **GenerateReview**: Left sidebar lists all recipients with status icons (⏳ pending, ✅ generated, ✏️ edited). Click a recipient to see their email in the main panel. "Generate All" button at top. Progress bar during generation. Each email shows: Subject line (editable), Body (editable textarea for now — Phase 2 adds TipTap), "Regenerate" button per recipient.

5. **EmailEditor**: For Phase 1, use a decent textarea with Markdown preview below it (using a simple markdown renderer). We'll add TipTap in Phase 2. Include: "Regenerate" button, tone selector (professional/friendly/formal/concise), word count.

DO NOT break the existing outreach types (follow_up, prep, outbound_campaign). The new wizard applies primarily to the "campaign" type. Keep backward compatibility — existing outreach records should still render in read-only mode.

#### F. FRONTEND: Install TipTap (prep for Phase 2)

Run: `cd apps/web && pnpm add @tiptap/react @tiptap/starter-kit @tiptap/extension-link @tiptap/extension-underline @tiptap/extension-placeholder`

Don't integrate yet — just install so Phase 2 can use it.

### TESTING
After implementation:
1. Run `npx prisma migrate dev` to apply migration
2. Run the seed script to populate system templates
3. Start the API (`pnpm dev --filter api`) and verify:
   - GET /api/engagement/outreach/templates returns 8 system templates
   - POST /api/engagement/outreach/templates creates a custom template
   - GET /api/engagement/outreach/insights?clientId=X returns insight data
4. Start the web (`pnpm dev --filter web`) and verify:
   - New outreach → campaign type shows the wizard
   - Step 2 shows multi-select recipient table
   - Step 3 shows intelligence insights with toggles
   - Step 4 shows template cards with preview
   - Step 5 generates emails per recipient
   - Existing outreach types (follow-up, prep) still work

### IMPORTANT CONSTRAINTS
- DO NOT delete or restructure the OutreachView.tsx file in a way that breaks existing functionality. Add the new wizard as an alternative path for the "campaign" type.
- All Prisma queries MUST use prisma.withTenant() — the app has row-level security.
- Use `Record<string, unknown>` for dynamic Prisma where clauses — NOT `Parameters<typeof>` patterns (those break in Docker builds).
- Frontend uses Ant Design throughout — match existing patterns.
- Keep the existing PROMPT_TEMPLATE_GUIDANCE in engagement-ai.service.ts for backward compatibility, but the new template system should use the DB-stored prompts instead.
