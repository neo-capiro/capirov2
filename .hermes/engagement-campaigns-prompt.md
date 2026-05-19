TASK: Add a Campaigns tab to the Engagement Manager and enhance meeting prep/debrief quality. Test end-to-end. Auto-accept all prompts. Push to staging when done.

## CONTEXT — READ THESE FILES IN ORDER:

1. apps/web/src/pages/engagement/EngagementPage.tsx (3304 lines — full engagement page with Meetings/Outreach/Reports tabs)
2. apps/web/src/pages/engagement/OutreachView.tsx (4870 lines — outreach/email campaign UI)
3. apps/api/src/engagement/engagement.controller.ts (API endpoints for meetings, outreach, prep, debrief)
4. apps/api/src/engagement/engagement.service.ts (service layer — meeting prep, debrief, outreach logic)
5. apps/api/src/engagement/engagement-ai.service.ts (AI prompts for prep, debrief, outreach)
6. apps/api/src/engagement/client-association.service.ts (client-meeting association logic)
7. apps/web/src/theme.css (existing styles)
8. apps/web/src/App.tsx (routing)

## WHAT TO BUILD

### 1. Add "Campaigns" Tab to Engagement Manager

Add a 4th tab called "Campaigns" to the Tabs component in EngagementPage.tsx (after Outreach, before Reports).

The Campaigns tab is a unified view for planning and executing multi-touch email campaigns tied to post-meeting follow-ups and ongoing client outreach.

Create a new file: `apps/web/src/pages/engagement/CampaignsView.tsx`

**Campaign concept**: A campaign is a sequence of emails sent to congressional targets based on meeting outcomes, debrief action items, and client program updates. It connects the meeting prep → debrief → follow-up → ongoing outreach pipeline.

**CampaignsView layout:**

TOP: Campaign list with filters
- "New Campaign" button
- Filter by: client, status (draft/active/paused/complete), type (post-meeting follow-up, ongoing outreach, event-based)
- Each campaign card shows: name, client, status, recipients count, sent/total, open rate, last activity

WHEN A CAMPAIGN IS SELECTED:

**Campaign Editor** (main content area):

**Header section:**
- Campaign name (editable)
- Client (dropdown from client list)
- Type: Post-Meeting Follow-Up | Congressional Outreach | Program Update | Custom
- Status badge: Draft → Active → Paused → Complete

**Source Context section (what drives the campaign content):**
- "Pull from Meeting" button — select a meeting, auto-imports:
  - Prep notes (talking points, agenda)
  - Debrief action items and recap
  - Attendee list as potential recipients
- "Pull from Debrief" button — select a debrief, imports:
  - Recap, action items, notes
  - Meeting context
- "Custom Context" textarea — additional context for AI generation

**Recipients section:**
- Table of recipients: Name, Email, Title, Office, Status (pending/sent/opened/bounced)
- "Add from Meeting Attendees" button — imports attendees from a linked meeting
- "Add from Directory" button — search congress directory
- "Add from Client Contacts" button — imports client people
- Inline add/remove

**Email Template section:**
- Subject line (with AI suggestion button)
- Body editor (rich text area)
- "Generate with AI" button — uses the campaign context (meeting prep, debrief, recipient info) to draft personalized emails
- Template variables preview: {recipient_name}, {recipient_title}, {meeting_date}, {action_items}
- "Preview" button — shows rendered email for selected recipient

**Send section:**
- "Send Test" — sends to your own email
- "Send All" — sends to all pending recipients via the existing Microsoft Graph send API
- Schedule option (date/time picker)

### 2. Campaign API Endpoints

Add to engagement.controller.ts and engagement.service.ts (or create a campaigns sub-module if cleaner):

- GET /api/engagement/campaigns — list campaigns (filter by clientId, status)
- POST /api/engagement/campaigns — create campaign { name, clientId, type, sourceContext }
- GET /api/engagement/campaigns/:id — get campaign with recipients
- PATCH /api/engagement/campaigns/:id — update campaign fields
- DELETE /api/engagement/campaigns/:id — delete campaign
- POST /api/engagement/campaigns/:id/recipients — add recipients
- DELETE /api/engagement/campaigns/:id/recipients/:recipientId — remove recipient
- POST /api/engagement/campaigns/:id/generate — AI generates email content using campaign context
- POST /api/engagement/campaigns/:id/send — sends emails to all pending recipients
- POST /api/engagement/campaigns/:id/send-test — sends test email to current user

### 3. Campaign Prisma Models

Add to schema.prisma:

```prisma
model EngagementCampaign {
  id              String   @id @default(uuid()) @db.Uuid
  tenantId        String   @map("tenant_id") @db.Uuid
  clientId        String?  @map("client_id") @db.Uuid
  createdByUserId String   @map("created_by_user_id") @db.Uuid
  name            String
  type            String   @default("custom") // post_meeting_followup, congressional_outreach, program_update, custom
  status          String   @default("draft") // draft, active, paused, complete
  subject         String?
  body            String?  @db.Text
  sourceContext   Json     @default("{}") @map("source_context_jsonb") // { meetingId, debriefId, prepId, customContext }
  metadata        Json     @default("{}") @map("metadata_jsonb")
  sentAt          DateTime? @map("sent_at") @db.Timestamptz(6)
  createdAt       DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt       DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  tenant     Tenant  @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  client     Client? @relation(fields: [clientId], references: [id], onDelete: SetNull)
  createdBy  User    @relation("CampaignCreator", fields: [createdByUserId], references: [id])
  recipients EngagementCampaignRecipient[]

  @@index([tenantId, clientId, status], map: "engagement_campaigns_tenant_client_status_idx")
  @@map("engagement_campaigns")
}

model EngagementCampaignRecipient {
  id         String   @id @default(uuid()) @db.Uuid
  tenantId   String   @map("tenant_id") @db.Uuid
  campaignId String   @map("campaign_id") @db.Uuid
  name       String?
  email      String
  title      String?
  office     String?
  status     String   @default("pending") // pending, sent, opened, bounced, failed
  sentAt     DateTime? @map("sent_at") @db.Timestamptz(6)
  metadata   Json     @default("{}") @map("metadata_jsonb")
  createdAt  DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

  tenant   Tenant              @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  campaign EngagementCampaign  @relation(fields: [campaignId], references: [id], onDelete: Cascade)

  @@index([tenantId, campaignId], map: "engagement_campaign_recipients_tenant_campaign_idx")
  @@map("engagement_campaign_recipients")
}
```

Add relation arrays to Tenant, Client, User as needed.

### 4. Campaign AI Generation

When "Generate with AI" is clicked, the API should:

1. Load the campaign's sourceContext (meetingId, debriefId, etc.)
2. Fetch the linked meeting with prep, debrief, attendees, client context
3. Build a prompt that includes:
   - Meeting recap and action items from the debrief
   - Prep talking points and agenda
   - Client description and program details
   - Recipient names and titles
   - Campaign type context (follow-up vs outreach vs update)
4. Generate a personalized email subject + body using the existing AI service pattern
5. Support template variables that get replaced per-recipient at send time

The email should read like a professional government affairs follow-up — not generic. It should reference specific meeting discussion points, action items committed to, and next steps.

### 5. Enhance Meeting Prep Quality

Update the prep prompt in engagement-ai.service.ts buildPrompt():

Current prompt is too generic. Enhance it to:
- Structure the prep as: Executive Summary → Key Discussion Points → Attendee Profiles → Talking Points → Risk Factors → Action Items → Logistics
- Include client capability data and funding ask when available
- Reference prior meeting debriefs with the same attendees
- Note any pending action items from previous meetings
- Include committee/subcommittee context from the congress directory matches
- Add a "Meeting Objective" section based on the meeting subject and client context

### 6. Enhance Debrief Quality

Update the debrief prompt in engagement-ai.service.ts buildDebriefPrompt():

Current prompt is minimal. Enhance it to produce:
- **Recap**: Structured summary with who said what, key decisions, commitments
- **Action Items**: Each with owner, deadline, priority (from context)
- **Follow-Up Required**: Specific next steps with suggested timeline
- **Intelligence Gathered**: Any new information about member positions, committee dynamics, upcoming hearings
- **Campaign Suggestion**: Auto-suggest a follow-up campaign based on the debrief

### 7. Migration

Generate migration with --create-only:
```
cd apps/api && npx prisma migrate dev --name add_engagement_campaigns --create-only
```
IMPORTANT: Clean the migration to ONLY include new table CREATE statements. Remove all DropForeignKey/AddForeignKey for existing tables.

### 8. CSS

Add styles for the Campaigns tab to theme.css:
- .campaign-list, .campaign-card, .campaign-editor
- .campaign-header, .campaign-context, .campaign-recipients
- .campaign-email-editor, .campaign-preview
- .campaign-send-actions
Match existing Capiro engagement styling.

### 9. Wire up in EngagementPage.tsx

Add the Campaigns tab to the Tabs items array:
```typescript
{
  key: 'campaigns',
  label: 'Campaigns',
  children: (
    <CampaignsView
      clients={activeClients}
      selectedClientId={selectedClientId}
      aiConfigured={Boolean(capabilities.data?.ai.activeProvider)}
    />
  ),
},
```

### 10. Testing

After all code is written:
1. Verify the API compiles: `cd apps/api && npx tsc --noEmit` (use the project tsconfig, not global)
2. Verify the web compiles: `cd apps/web && npx tsc -p tsconfig.json --noEmit`
3. Check that the migration SQL is clean (only new tables)
4. Verify the campaign endpoints work conceptually (correct Prisma queries, proper tenant scoping with withTenant)

### 11. Git + Deploy

After all tests pass:
```bash
git add -A
git commit -m "feat(engagement): add Campaigns tab + enhance prep/debrief AI quality"
git push origin dev-environment
git checkout main
git merge dev-environment --no-edit
git push origin main
git checkout dev-environment
```

Then build and deploy:
```bash
aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin 967807252336.dkr.ecr.us-east-1.amazonaws.com
docker build --platform linux/arm64 --no-cache -t capiro-api -f apps/api/Dockerfile .
docker buildx build --platform linux/arm64 --no-cache -f apps/web/Dockerfile -t capiro-web --load .
# Push to staging
docker tag capiro-api:latest 967807252336.dkr.ecr.us-east-1.amazonaws.com/capiro/staging/api:latest
docker push 967807252336.dkr.ecr.us-east-1.amazonaws.com/capiro/staging/api:latest
docker tag capiro-web:latest 967807252336.dkr.ecr.us-east-1.amazonaws.com/capiro/staging/web:latest
docker push 967807252336.dkr.ecr.us-east-1.amazonaws.com/capiro/staging/web:latest
# Deploy
aws ecs update-service --cluster capiro-staging --service capiro-staging-api --force-new-deployment --region us-east-1
aws ecs update-service --cluster capiro-staging --service capiro-staging-web --force-new-deployment --region us-east-1
```

## CRITICAL RULES:
- DO NOT modify existing EngagementPage.tsx beyond adding the new tab to the items array
- DO NOT modify OutreachView.tsx at all
- All new campaign logic goes in NEW files (CampaignsView.tsx, campaign endpoints in controller/service)
- Use withTenant() for ALL Prisma queries (the DB has RLS)
- Follow exact patterns from the existing outreach endpoints
- The migration MUST be cleaned — only CREATE TABLE + indexes + FKs for new tables
- Auto-accept all prompts during development
