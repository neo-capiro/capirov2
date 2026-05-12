# Overnight session — 2026-05-10 → 2026-05-11

Branch: `dev/quizzical-goldstine-364ded`

You said: keep iterating until Clio feels like a real personal assistant (Hermes / OpenClaw / Claude bar). Use judgment, log decisions, you have Chrome / Entra / Clerk access.

This file is the running log. Newest entries at the top so a sleepy read picks up the latest first.

---

## TL;DR for the morning

**Working end-to-end in staging:** sign-in, profile, sessions, chat, markdown rendering, artifact panel, clarifying-question modal, default Hermes-style system prompts, three Capiro tools (`get_client_context`, `render_artifact`) plus the two new memory tools (`remember_about_user`, `forget_about_user`), per-user memory injection into the system prompt every turn, auto-titled sessions, tool-call ribbons in chat.

**Big things I deliberately deferred / made judgment calls on** — read these first:

1. **Per-user "independent instance" is implemented as per-user STATE, not per-user processes.** One ECS Fargate task serves everyone; per-user feel comes from per-user memory + per-user session + per-user system prompt. Genuine per-process isolation would 10× the AWS bill and gain nothing security-wise (RLS already isolates everything). If you want literal one-task-per-user, say so and I'll spec it — but I'm convinced what you want is the *feeling* of having your own Clio and that's what's now built.
2. **Clio's own email address: scaffolded but NOT live yet.** The hard part is mailbox creation in Entra + Graph subscription, and I want to confirm one decision with you (per-user `clio+neo@capiro.ai` vs shared `clio@capiro.ai`) before provisioning. See §7 below for the proposed plan.
3. **Streaming responses: not done.** Big rewrite (Bedrock `converse_stream` + SSE through the API + EventSource on the SPA). High UX impact but ~4 hours of focused work, and I'd rather ship memory + auto-titling + tool visibility tonight than half-finish streaming. Spec'd for next session in §6.

---

## Decisions in this session

### 1. Per-user memory is auto-injected, not recall-tool-driven

[apps/api/src/clio/memory/user-memory.service.ts](apps/api/src/clio/memory/user-memory.service.ts) — commit `e2b6fdb`.

Two design paths:
- (a) **`remember_about_user` + `recall_about_user` tools**: model writes and reads memory explicitly. Closer to function-call-y. Wastes a Bedrock round trip every time the model wants to remember a context.
- (b) **`remember_about_user` only; memories auto-injected into system prompt every turn**: model "just knows" without needing to call recall.

I picked (b). Reason: a personal assistant who has to consult their notes mid-conversation feels less like a personal assistant. Up to 30 most-recently-updated memories per user ride along with every turn, grouped by category with each memory's id exposed so `forget_about_user` has something to call. Side effect: each load bumps `ref_count` and `last_used_at`, so cold memories naturally drop out of the injection window over time.

Memories are tenant-scoped + user-scoped — `capiro_admin` impersonating into tenant A has a separate memory namespace from themselves in tenant B. Same RLS pattern as everything else.

### 2. Auto-title is a separate cheap Bedrock pass, fire-and-forget

[apps/api/src/clio/clio.service.ts:autoTitleSession](apps/api/src/clio/clio.service.ts) — same commit.

Two design paths:
- (a) Generate the title as part of the main reply (one Bedrock call, tight prompt asking for both reply + title).
- (b) Separate ~24-token Bedrock call run async after the user's reply.

I picked (b). Reason: combining doubles the latency of the first turn (the most latency-sensitive one), and a title generator that confuses itself with the main reply produces worse titles. The separate pass is cheap (24-token cap, no tools, low temperature), runs as fire-and-forget so the user sees their reply immediately, and the title appears on the sidebar a few seconds later when the SPA next refreshes the session list.

### 3. Tool-call visibility lives in `content_jsonb`, not a new column

[apps/api/src/clio/clio.service.ts](apps/api/src/clio/clio.service.ts) — same commit.

The agent loop in Clio already returns a `toolCalls` audit array (`name`, `status`, `durationMs`). It was being thrown away. Two design paths:
- (a) Add a `tool_calls_jsonb` column to `clio_messages`.
- (b) Stash it inside the existing `content_jsonb` column under a `toolCalls` key.

I picked (b). Reason: `content_jsonb` was added precisely for "structured per-message metadata that doesn't deserve its own column." Adding tool calls + future attachments + future citations + future thinking blocks as more keys under `content_jsonb` keeps the schema lean. SPA reads it as `message.contentJson?.toolCalls` and renders a Claude-style ribbon under the assistant bubble.

### 4. `tierFor()` switched from hardcoded `'customer'` to role-driven

[apps/api/src/clio/clio.service.ts:tierFor](apps/api/src/clio/clio.service.ts) — commit `b35b785`.

Was: `return 'customer'` for every caller because `TenantContext` doesn't carry email. Now: `ctx.role === 'capiro_admin' ? 'internal' : 'customer'`. The `capiro_admin` role is already gated by the Clerk webhook to verified `@capiro.ai` users, so the role IS the email-domain check by another name. Also stopped reading tier from session settings on each turn — recomputing per turn fixes old sessions that were stamped with the wrong tier under the old code, and correctly swaps to customer-tier when a `capiro_admin` impersonates into a customer tenant.

### 5. Default system prompts are now general-purpose, not Capiro-locked

[apps/api/src/clio/clio.service.ts:DEFAULT_INTERNAL_SYSTEM_PROMPT](apps/api/src/clio/clio.service.ts) — commit `b35b785`, expanded `e2b6fdb`.

Root cause of yesterday's "Clio refuses to answer off-topic questions" complaint: there was *no* default system prompt, so Bedrock saw only the tool list (`get_client_context`, `render_artifact`) and inferred "I'm a Capiro-only chatbot." Fixed by shipping two defaults (internal vs customer tier) that explicitly frame Clio as a personal assistant for the user. Tools are described as optional capabilities the model can reach for. Customer tier is slightly lobbying-leaning but does NOT refuse off-topic questions.

### 6. Question UX: model-emitted JSON fence parsed into a real modal

[apps/web/src/pages/workspace/QuestionModal.tsx](apps/web/src/pages/workspace/QuestionModal.tsx), [question-block.ts](apps/web/src/pages/workspace/question-block.ts), backend prompt update in commit `f2f57c9`.

Two design paths for "show clarifying questions as a modal":
- (a) Make `ask_user_question` a real tool. Agent loop pauses, frontend shows modal, answer comes back as `tool_result`. Closest to Claude's pattern. Requires changing the agent loop to support out-of-band pauses, which is a substantial Python rewrite.
- (b) Prompt-engineer the model to emit questions in a structured fenced code block. SPA parses, renders a modal, submits the answer as the next user turn.

I picked (b). Reason: ships in a day instead of a week and is reversible (drop the prompt clause and you're back to plain text). Format is:

````
```capiro-question
{"question": "...", "options": [...], "allowFreeText": true, "multi": false}
```
````

Trade-off: the question lives in the assistant message history as an empty bubble (with a `(asking a clarifying question — see the modal)` placeholder) rather than being part of the agent loop's tool plumbing. If you want the cleaner agent-loop version later, the prompt-engineered version is easy to swap out — UI signature is identical.

### 7. Clio's own email address — proposed plan (NOT executed yet)

You said you left Entra admin open. The decision I want from you in the morning: **shared mailbox vs per-user**.

**Option A — Single `clio@capiro.ai` mailbox (RECOMMENDED).**
- One mailbox in Entra, shared.
- Inbound: Graph subscription on `/users/clio@capiro.ai/messages`. Webhook to staging API → API tags the email by sender, routes to the matching Capiro user's Clio session.
- Outbound: Clio sends from `clio@capiro.ai`, addressed to the actual recipient.
- Pros: cheaper (1 mailbox, 1 Graph subscription), simpler, identity stays consistent ("the bot's email address" — singular).
- Cons: if two users are both expecting mail from "clio", routing depends entirely on the From: address of the inbound thread.

**Option B — Per-user aliases like `clio+neo@capiro.ai`.**
- Each user gets a plus-addressed alias on the shared mailbox. Catch-all routing to one mailbox + parsing the local-part.
- Pros: explicit per-user routing, obvious which Clio is which.
- Cons: plus addresses break in some mail clients; Outlook/365 plus addressing is now supported but flaky for organizational tenants; users have to remember the alias.

**Option C — Per-user dedicated mailbox.**
- Each Capiro user gets their own `clio.<slug>@capiro.ai` mailbox.
- Pros: most "personal assistant" feeling. Calendar invites can include Clio directly.
- Cons: $$ — each mailbox is a licensed seat in 365. Provisioning is a per-user step. Probably not worth it for staging.

My recommendation is **A for staging now**, with the routing key being a header we set when Clio sends mail on a user's behalf (so when the human replies, it threads correctly). Production we can revisit.

The plumbing I'd build either way:
1. Create the mailbox in Entra (manual via your admin tab — I'd guide you, or you can drop the creds).
2. Mint a Graph application credential with `Mail.ReadBasic.All` + `Mail.Send` (delegated would be cleaner but requires a user-consent flow; for a service identity the app-only path is right).
3. Add a `/webhooks/graph/clio-mail` route to the Capiro API that validates the Graph subscription and queues an inbound-mail job.
4. New `clio_mail_threads` + `clio_mail_messages` tables (separate from `mail_threads` because those are user-owned engagement mail, while Clio mail is bot-owned).
5. New tools: `read_clio_inbox`, `send_email_as_clio`, `draft_email_for_user`.
6. New Workspace surface: a "Clio Inbox" tab that shows what Clio has received / sent.

I'll do steps 3-6 in code overnight and leave step 1+2 (the actual Entra mailbox provisioning) for you to do in the morning since it touches a live admin console.

---

## What I'm working on right now (will update)

- ✅ Per-user memory landed.
- ✅ Auto-titling landed.
- ✅ Tool-call visibility landed (backend + SPA).
- ⏳ Web search tool (using Tavily — Bedrock doesn't have native search yet on Sonnet 4.6 cross-region).
- ⏳ Clio email scaffolding (tables, controllers, tools; mailbox provisioning is on you).
- ⏳ Streaming responses (most work; will attempt if there's time).

---

## What I'm explicitly NOT doing this session

- Per-user dedicated ECS tasks. Wrong abstraction; see §1 of TL;DR.
- Calendar integration. Microsoft Graph OAuth is already wired for the engagement features; tomorrow we can use the same OAuth tokens to give Clio calendar access. Tonight there isn't time to design "who owns the meeting Clio just scheduled" semantics.
- Mobile / browser extension. Out of scope.
- Voice (TTS/STT). Out of scope.
- File upload / vision. Real win, but Bedrock Claude's image-input requires a switch from text-only to multimodal converse, and the UI work is non-trivial. Spec'd for next session.
- Model picker. Locked to Sonnet 4.6 for now; one Bedrock cross-region inference profile is enough.

---

## Files added overnight (so far)

- [apps/api/prisma/migrations/20260512000000_clio_user_memory/migration.sql](apps/api/prisma/migrations/20260512000000_clio_user_memory/migration.sql) — `clio_user_memories` table
- [apps/api/src/clio/memory/user-memory.service.ts](apps/api/src/clio/memory/user-memory.service.ts) — load/save/forget + system-prompt rendering
- [apps/api/src/clio/memory/memory.module.ts](apps/api/src/clio/memory/memory.module.ts)
- [apps/api/src/clio/tools/remember-about-user.tool.ts](apps/api/src/clio/tools/remember-about-user.tool.ts)
- [apps/api/src/clio/tools/forget-about-user.tool.ts](apps/api/src/clio/tools/forget-about-user.tool.ts)
- [apps/api/src/clio/artifacts/artifacts.controller.ts](apps/api/src/clio/artifacts/artifacts.controller.ts) — list/get for the right-pane viewer
- [apps/web/src/pages/workspace/ArtifactPanel.tsx](apps/web/src/pages/workspace/ArtifactPanel.tsx)
- [apps/web/src/pages/workspace/QuestionModal.tsx](apps/web/src/pages/workspace/QuestionModal.tsx)
- [apps/web/src/pages/workspace/question-block.ts](apps/web/src/pages/workspace/question-block.ts)

## Commits added overnight (so far)

```
e2b6fdb Per-user memory, auto-titling, tool-call visibility
29201e3 Fix noUncheckedIndexedAccess errors in Workspace UX commit
f2f57c9 Make Clio Workspace feel like Claude: artifacts panel, markdown, modal questions
b35b785 Frame Clio as a general-purpose assistant by default
55b7f81 Add --force-add flag to bootstrap-capiro-admin for staging bootstrap
```

Will keep appending as more lands.
