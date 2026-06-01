# Overnight findings — 2026-05-31

Surprises, pre-existing bugs, debt, security smells, and suggestions. Terse; one bullet per finding.

## Security smells
- **GitHub PAT embedded in the git remote URL** (`git remote -v` shows a `ghp_…` token in the `origin`
  fetch/push URL). Recommend rotating that token and switching to a credential helper / `gh auth` so the
  secret isn't stored in plaintext `.git/config`. (Not committed to the repo; local config only — but
  still a leak risk, e.g. if `.git/config` is ever shared or synced. Note: this clone is under OneDrive,
  which **does** sync `.git/config`.) I did not reproduce the token value anywhere.

## Build / tooling
- **`eslint` is not installed and not configured anywhere** (no `.eslintrc*`, no binary in any
  `node_modules/.bin`). Both `apps/api` and `apps/web` `lint` scripts call `eslint` and therefore always
  fail. `pnpm lint` has presumably never passed in CI/locally. Either install+configure ESLint
  (flat config for v9, or `.eslintrc` for v8) across the monorepo, or remove the dead `lint` scripts to
  stop them masquerading as a gate.

## Concurrency / environment
- **Many concurrent agent worktrees** (25+) on this single clone — `C:/tmp/capiro-*` (17) and
  `.claude/worktrees/*` (8, incl. `parallel/track-b-artifacts`). `main` advanced + got a FF-merge during
  my run. If overnight roadmap work is being parallelized, consider a coordination doc / lock so tracks
  don't duplicate (e.g. two agents both implementing P0-1). The OneDrive-synced `.git` + many worktrees
  is also a sync-thrash risk.
- The OneDrive clone's `.git` is cloud-synced. Heavy git activity (commits, worktrees, packs) under
  OneDrive can cause sync churn and, rarely, `.git` corruption. Suggest moving the canonical clone out of
  the synced path (e.g. `C:\dev\capirov2`).

## Code observations (during P0 work)
- `clio.service.ts` is ~1900 lines and is the hot file for nearly every P0 task. Consider extracting
  the `streamMessage` agentic loop into its own `clio-chat-loop.service.ts` — it would reduce
  merge-conflict surface across the parallel agent tracks and make it unit-testable.
- The Clio chat brain calls `api.anthropic.com` directly (not Bedrock); embeddings use OpenAI
  `text-embedding-3-small` (clio.service.ts ~1322/1352) while the rest is Anthropic — worth confirming
  that OpenAI embedding path is intended given the "Anthropic primary / OpenAI is P3-only" rule.
- Web message renderer uses `dangerouslySetInnerHTML` with a hand-rolled markdown function. It is
  XSS-guarded (escapeHtml first, http(s)-only links), but a vetted sanitizer would be more robust if
  the source of `content` ever broadens beyond model output.

## Suggestions for next session (precise, actionable)
- **Finish P0-4 (Regenerate + Edit-and-resend).** Backend: add a turn-truncation mode to the stream
  endpoint — e.g. `POST /clio/conversations/:id/stream` with `{ regenerate: true }` deletes the last
  assistant message and re-streams from existing history WITHOUT re-persisting the user message; and
  `{ resendFromMessageId }` truncates all messages after that user message (delete) then re-streams.
  Add `ClioService.truncateConversationAfter(ctx, conversationId, messageId)` + `deleteLastAssistant`.
  Frontend: per-message actions on the last assistant ("Regenerate") and last user ("Edit") messages;
  add `removeMessagesAfter(id)` / `replaceMessageContent(id, content)` to chat-store and a small pure
  `chat-conversation.helpers.ts` (truncation logic) with a vitest spec. Factor the SSE fetch+parse
  core out of `sendMessage` into `streamAssistantTurn()` so regenerate/edit reuse it.
- **P0-5 (skill registry — KEYSTONE).** Not started. Build `apps/api/src/clio/skills/` with one TS
  module per skill `{ id, name, triggers, systemAddendum, requiredTools, templates }`, a `SkillRegistry`
  loader that matches triggers against intent/message and injects only the matched skill's addendum +
  tools lazily. Migrate exactly TWO existing templates (the `generate_briefing` + `generate_draft`
  intent guidance + any briefing/draft template produced in `orchestrateContext`) as proof, behind a
  flag, and add a unit test asserting byte-identical output vs the current hardcoded path (the eval-
  harness parity check waits on P1-1). Keep the static skill bundle cacheable separately (composes
  with P0-1).
- **P0-6 (grounding/verifier gate).** Not started. New `verifier.service.ts`: after a briefing/memo/
  research deliverable, a cheap Haiku call takes (output + retrieved sources) → `{claim, supported,
  sourceIds}[]`. Flag unsupported claims in the UI; if >20% unsupported, mark "low confidence" banner.
  Gate with `CLIO_VERIFIER_ENABLED`. Do NOT gate raw chat — only deliverables. The P0-3 citation
  registry (`clio-citations.helpers.ts`) already gives you the per-source ids to verify against.
- **Run the P0-1 smoke** (`apps/api/test/smoke/clio-prompt-cache.smoke.ts`) with a real
  ANTHROPIC_API_KEY to confirm live `cache_read_input_tokens > 0` on turn 2.
