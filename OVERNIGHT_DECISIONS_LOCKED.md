# Decisions you locked in (post-overnight)

You answered the four open questions. Here's what I'm building against.

## 1. Connectors are per-USER, not per-tenant

For Gmail / GitHub / Slack / Linear / Notion / custom MCP — each Capiro user connects their own. `clio_connectors` table (already spec'd in §14) becomes the source of truth, scoped on `(tenantId, userId, provider)`. Microsoft 365 and Google Workspace stay tenant-scoped because they're org-level integrations the admin owns.

What this means in code:
- New `clio_connectors` table replaces the partial-reliance on `engagement_connections` for personal mail/calendar.
- OAuth callback handlers stamp `userId` from the authenticated session at start time.
- Tool execution always loads the calling user's connector row — never falls back to a tenant-wide token.
- "Disconnect" removes only that user's row; other users in the same tenant are unaffected.

## 2. Sandbox follows industry best practices (ChatGPT-grade)

You said "ChatGPT is able to run code and give me results, it should be the same." That means:
- Full Python interpreter, not a constrained DSL.
- Persistent file workspace per session (so the user can iterate: "now sort that by date" picks up the same DataFrame).
- File outputs surface as downloadable artifacts in the UI.
- Network limited to public APIs (no egress to internal infra).
- Resource limits prevent abuse but allow real work.
- The agent doesn't ask for permission to run code — it just runs.

Architecture choice locked: **separate Fargate task (`clio-sandbox`)** with the runner + rlimits + scoped S3 IAM, exactly as §16 spec'd. Already partially built. Next session: CDK stack + deploy.

Two refinements I'm adding on top of the original spec based on this answer:

a. **Persistent workspace per session.** Each chat session gets its own working directory `/workspace/` that survives across `code_interpreter` calls within the same session. Files written in turn 1 are still there in turn 5. Cleanup happens when the session is archived (or after 24h of inactivity).

b. **Streaming partial output.** ChatGPT shows code running line-by-line. We'll wire SSE so the sandbox streams stdout as it's produced, not just at the end. (Stretch; can wait for v2 if SSE turns out to be hairy in the agent loop.)

## 3. Custom MCP servers — per-tool approval

When a user connects a custom MCP server (via the "Custom MCP server" tile on the Connectors page), the server advertises a tool list. Each tool starts as **untrusted** — the user must explicitly approve it before the agent can call it.

UI flow:
- User pastes MCP server URL → API connects → fetches `tools/list`.
- Connector card shows the tool list with checkboxes, each unchecked by default.
- User checks the tools they trust → "Save" persists the approval list.
- Agent loop can only call approved tools. Unapproved tool calls return "tool not authorized" to the agent so it can apologize and re-prompt.

Schema: `clio_connectors.config_jsonb.approvedTools: string[]` on the custom MCP row.

This is significantly more conservative than how built-in tools work (which are pre-approved). Trust scaling: built-in > tenant-OAuth (Microsoft 365) > user-OAuth (Gmail/GitHub) > custom MCP (approval-gated).

## 4. Per-user Clio email address — full design

This is the biggest architectural addition. Every Capiro user gets their own dedicated address so they can email Clio (and Clio can email them, and they can CC Clio on threads).

### Address format

`<user-slug>@clio.capiro.ai` — dedicated subdomain, slug-as-local-part. E.g. `neo@clio.capiro.ai` for me.

Slug rules:
- Default to the local-part of the user's Clerk email (`neo@capiro.ai` → `neo`).
- Collisions: append a digit (`neo2@clio.capiro.ai`).
- User can override their slug from the Settings page once.
- Lowercase, `[a-z0-9-]{2,40}`.

### Infrastructure (next session, CDK stack)

```
Inbound:
  Internet → Route53 MX record → SES inbound endpoint
              (clio.capiro.ai)        (us-east-1)
                                          ↓
                                       SES rule set
                                          ↓
                                       S3 (raw mail)
                                          ↓
                                       Lambda (parse + auth)
                                          ↓
                                       POST /webhooks/clio-mail
                                       (HMAC-signed by Lambda)
                                          ↓
                                       ClioMailService
                                          ↓
                                       Autonomous Clio session
                                       (spawns a chat turn as the
                                        user, with the email as the
                                        user prompt)

Outbound:
  Clio agent calls send_email tool → API → SES SendEmail
                                       (From: <slug>@clio.capiro.ai)
```

### New tables

```prisma
model ClioMailbox {
  id           String   @id @default(uuid()) @db.Uuid
  tenantId     String   @map("tenant_id") @db.Uuid
  userId       String   @unique @map("user_id") @db.Uuid
  localPart    String   @unique @map("local_part")  // 'neo' → neo@clio.capiro.ai
  fullAddress  String   @unique @map("full_address") // denormalised: 'neo@clio.capiro.ai'
  active       Boolean  @default(true)
  // Auto-respond when an email arrives? Off by default — user has to
  // explicitly turn on "let Clio reply automatically".
  autoReply    Boolean  @default(false) @map("auto_reply")
  createdAt    DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt    DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)
  // RLS: tenant-scoped.
  @@map("clio_mailboxes")
}

model ClioInboundMail {
  id           String   @id @default(uuid()) @db.Uuid
  tenantId     String   @map("tenant_id") @db.Uuid
  userId       String   @map("user_id") @db.Uuid
  mailboxId    String   @map("mailbox_id") @db.Uuid
  // Raw SES delivery metadata
  sesMessageId String   @unique @map("ses_message_id")
  rawS3Key     String   @map("raw_s3_key")  // s3://capiro-mail-inbound/...
  // Parsed
  fromAddress  String   @map("from_address")
  fromName     String?  @map("from_name")
  toAddress    String   @map("to_address")
  subject      String
  bodyText     String?  @map("body_text")
  bodyHtml     String?  @map("body_html")
  // Lifecycle
  receivedAt   DateTime @default(now()) @map("received_at") @db.Timestamptz(6)
  processedAt  DateTime? @map("processed_at") @db.Timestamptz(6)
  clioSessionId String? @map("clio_session_id") @db.Uuid  // session the inbound spawned
  status       String   @default("pending")  // 'pending' | 'processed' | 'replied' | 'ignored' | 'error'
  errorMessage String?  @map("error_message")
  @@index([tenantId, userId, receivedAt(sort: Desc)])
  @@map("clio_inbound_mail")
}

model ClioOutboundMail {
  id            String   @id @default(uuid()) @db.Uuid
  tenantId      String   @map("tenant_id") @db.Uuid
  userId        String   @map("user_id") @db.Uuid
  mailboxId     String   @map("mailbox_id") @db.Uuid
  clioSessionId String?  @map("clio_session_id") @db.Uuid
  inReplyToId   String?  @map("in_reply_to_id") @db.Uuid  // FK to clio_inbound_mail when this is a reply
  sesMessageId  String?  @map("ses_message_id")
  toAddress     String   @map("to_address")
  ccAddress     String?  @map("cc_address")
  subject       String
  bodyText      String   @map("body_text")
  bodyHtml      String?  @map("body_html")
  sentAt        DateTime @default(now()) @map("sent_at") @db.Timestamptz(6)
  @@map("clio_outbound_mail")
}
```

### New API endpoints

- `POST /webhooks/clio-mail` — inbound from the Lambda. HMAC-signed payload. Parses → creates `clio_inbound_mail` row → spawns or appends to a Clio session for the addressed user.
- `GET  /api/clio/mailbox` — read the current user's mailbox state (address, autoReply setting).
- `PATCH /api/clio/mailbox` — update slug (once) or autoReply.
- `GET  /api/clio/inbox` — read recent inbound mail for the current user.

### New Clio tool

`send_email` — agent can email someone (the user, the original sender of an inbound, anyone). Goes through SES from the user's Clio mailbox address. Tool input: `{ to, cc?, subject, body, inReplyToInboundId? }`.

### Bootstrap flow

When a Capiro user first signs in, an idempotent `ensureMailbox(userId)` provisions:
- A `clio_mailboxes` row.
- A welcome email from Clio to the user's primary email introducing the address.

User sees their Clio email address prominently in the Workspace header ("📧 neo@clio.capiro.ai — copy") so they can drop it into a thread anytime.

### What still needs your judgement before we ship

1. **Auto-reply default.** I have it OFF by default. Want it ON for internal-tier users (Capiro staff)?
2. **CC vs primary recipient.** When a user CC's `neo@clio.capiro.ai` on a thread to someone else, should Clio reply to all, just the user, or just take note silently? My default: take note silently, surface in the Workspace as a "Clio observed this thread" inbox item.
3. **Spam.** SES + a basic SPF/DKIM/DMARC setup gets us 95%. Beyond that I'd add a per-user "blocked sender" list. Worth building day-one or wait for actual spam?
4. **Domain confirmation.** `clio.capiro.ai` is the cleanest. Confirm before I touch DNS?

## Build order across all four

Roughly:

1. **Next session**: clio-sandbox CDK stack + deploy + verify Excel/Word/PPT generation working.
2. **Following session**: `clio_connectors` table + Gmail OAuth (first per-user connector) + UI for connecting/disconnecting on the Connectors page.
3. **Then**: Per-user email — SES domain verification + DNS + Lambda + webhook + tool + UI. Roughly 1.5 sessions because the manual SES verification + DNS propagation is unavoidably slow.
4. **Then**: Custom MCP server connector with the per-tool approval UI.
5. **Then**: Persistent code workspace per session (ChatGPT-style "remember the variables").

Each row is a focused session with a clean validate-and-ship endpoint.
