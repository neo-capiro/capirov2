# White Paper "Guide Agent" — Failure Diagnosis & Resolution Plan

Status: investigation only (no code changed). Branch reviewed: `origin/main` @ `a60404d`
(the merged whitepaper overhaul). Live dev: https://app.capiro.ai (ECS api+web both
confirmed running the new images; AI keys present as task secrets).

## What "works" vs what doesn't (evidence)

Confirmed DEPLOYED and reachable:
- API routes registered: `whitepaper/variants`, `generate-document`, `generate-section`,
  `context-candidates`, `whitepaper-lint`, `export.docx` (all return 401 unauth, i.e. they
  exist). `POST /chat/draft-whitepaper-section` also deployed.
- Live web bundle (`/assets/index-*.js`) contains the new strings: `whitepaper/variants`,
  `generate-section`, `context-candidates`, `whitepaper-lint`, "Start your white paper",
  "Draft full paper". So the rewritten editor IS served.
- Live API logs show active `PATCH /api/workflows/instances/:id` autosaves + `GET
  /api/strategies/:id` — the editor loads and saves for real users right now.

NOT working — root causes below.

## Root cause #1 (PRIMARY): the agentic "ask Clio to write the paper" path is not wired

The backend write-back method `ChatService.draftWhitePaperSection()` and its route
`POST /chat/draft-whitepaper-section` were shipped, BUT:
- No frontend code ever calls that endpoint. `git grep draft-whitepaper-section` across
  `apps/web` = 0 hits; the live JS bundle = 0 hits. The ChatDrawer only got a cosmetic
  context label ("White Paper: <title>") + an `activeWhitePaper` store value.
- The streaming chat path (`streamMessage` → `classifyIntent`) has NO white-paper intent.
  `ChatIntent` includes `edit_workflow_field` but nothing that targets white-paper sections,
  and `draftWhitePaperSection` is a separate non-streaming method that the stream never calls.

Net effect: when a user opens the Clio chat bubble on the white-paper page and says
"draft the Problem Statement / write this section," Clio replies with TEXT in the chat and
never writes anything back into the paper. From the user's POV the "guide agent" does nothing.
This is the most likely meaning of "the guide agent feature does not work."

## Root cause #2 (LIKELY, needs auth repro to confirm): editor guided flow depends entirely on the variants query

Everything in the in-editor guided experience is gated on `variantsQuery.data`:
- The Start modal grid maps over `variantsQuery.data` — if empty, the modal shows NO
  clickable format cards.
- The Format dropdown maps over `variantsQuery.data` — empty = no options.
- `startWithVariant(slug)` does `variantsQuery.data?.find(...); if (!variant) return;` — a
  silent no-op when the list is empty.

`GET /api/workflows/whitepaper/variants` returns a static array server-side, so it *should*
populate. But it must be verified with an authenticated session — if that one call 401s/blocks
(token/tenant-guard edge) or is cached empty, the entire guided UI is inert with no error
shown. (Could not reproduce here: no Clerk login available to the investigation.)

## Root cause #3 (CONTRIBUTING): no explicit "ask Clio" affordance in the editor

The editor's Clio panel only has buttons ("Draft with Clio", "Rewrite", "Draft full paper")
that hit the workflows endpoints directly. There is no conversational/guided agent in the
editor that interviews the user, proposes structure, and writes sections — which is what
"guided agentic experience" implies. The guidance is currently static (a Start modal +
recommendations list), not an agent.

## Resolution plan (no changes yet — for approval)

### Phase A — make the agent actually write back (fixes #1)
1. Wire the ChatDrawer (or the editor's Clio panel) to call
   `POST /chat/draft-whitepaper-section` when `getActiveWhitePaper()` is set and the user
   asks to draft/rewrite a section. Two options:
   a. Add a white-paper branch in the chat send flow: when on a `/white-paper/` page and the
      message is a draft/rewrite request, call the write-back endpoint instead of (or in
      addition to) the stream, then refresh the editor's `workflow-instance` query so the
      new section text appears in the paper.
   b. Simpler/safer first cut: add explicit "Draft this section with Clio" actions in the
      editor that call the endpoint directly (no NL classification), then iterate to NL.
2. Add a `whitepaper_draft_section` (and optional `whitepaper_structure`) intent to
   `classifyIntent` + `streamMessage`, so a natural-language request in the bubble routes to
   `draftWhitePaperSection` and the result is both shown and written back.
3. After write-back, broadcast a refresh so the open editor re-pulls
   `['workflow-instance', id]` and renders the updated section (the editor already keys off
   that query).

### Phase B — guarantee the editor guided flow loads (fixes #2)
4. Reproduce with a real login; capture the Network tab for
   `GET /api/workflows/whitepaper/variants` (status + body) and the console.
5. If it 401s/empties: add a resilient fallback — ship the 3 variants as a small client-side
   constant so the Start modal/dropdown are never empty even if the call fails, and surface a
   visible error toast on query failure (currently failures are swallowed → silent dead UI).
6. Add a non-blocking error state to `variantsQuery` and `candidatesQuery` so a failed call
   shows "couldn't load formats — retry" instead of an empty modal.

### Phase C — make it a real guided agent (fixes #3, the actual ask)
7. In the editor Clio panel, add a conversational guided mode: Clio proposes a structure for
   the chosen format, asks 2-4 targeted gap-filling questions (ask amount, district nexus,
   etc.), then drafts section-by-section with write-back and inline review. Reuse the
   `draftWhitePaperSection` write-back from Phase A.
8. Add a "Start with Clio" entry on a blank paper that runs the interview → scaffold → draft
   loop, rather than the current static modal.

### Phase D — verification (end-to-end, the standard for "live")
9. Local: unit-test the chat write-back intent routing; component-test that an empty
   variants response still renders clickable formats (fallback).
10. Deployed: with a real login, confirm (a) Start modal shows 3 formats and scaffolds on
    click; (b) "Draft with Clio" on a section returns real text into THAT section; (c) the
    chat bubble "draft the X section" actually changes the paper; (d) Export DOCX downloads a
    valid file. Verify via Network tab that `generate-section` / `draft-whitepaper-section`
    actually fire and 200 — not just that the UI looks right.

## Suggested order
PR-A (Phase A + B): wire the write-back the agent already has a backend for, plus the
variants fallback/error surface — this is what makes the feature visibly work. Ships first.
PR-B (Phase C): the full conversational guided agent.

## Notes / guardrails
- All of this is content drafting + chat wiring; no auth/Clerk/email/Outlook surface. Data
  model is unchanged (formData JSON). No migration.
- The chat write-back already persists structured sections + the flat `generated_document`
  mirror, so once the frontend calls it, the dashboard and editor stay in sync.
- I could not reproduce behind Clerk login from the investigation environment; Phase B step 4
  needs a quick authed repro (or a HAR/console capture from Neo) to confirm whether #2 is
  active in addition to #1.
