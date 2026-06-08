# White Paper Tool — Bug Audit & Enhancement Plan

Scope: the "Program White Paper" workflow tool reachable at
`/workspace/strategy/:id/white-paper/:instanceId` (frontend `WhitePaperEditorPage.tsx`)
backed by `WorkflowsService.generateDocument()` and the Clio chat service.

---

## PART 1 — BUGS (current state)

### CRITICAL — the feature is fundamentally broken end-to-end

**B1. "Draft with Clio" and "Rewrite" are fake — no AI is called.**
`generateOneSection()` calls the local `inferSectionDraft()` helper, a pure client-side
string template. It emits boilerplate like "Client should position the program as a
high-confidence priority…" with zero real content, no client/program/strategy data, and
never touches the API. The two most prominent buttons in the editor produce filler text.
(File: WhitePaperEditorPage.tsx L103-134, L434-456, L641-656.)

**B2. "Draft full paper" destroys the section structure.**
The real AI endpoint returns ONE monolithic `generated_document` string. On success the
frontend does `defaultSections(result.generated_document)`, which dumps the ENTIRE document
into section 1 ("Executive Summary") and leaves the other 5 sections blank
(WhitePaperEditorPage.tsx L56-62, L338). So after a real generation the outline shows 1/6
done and a wall of text under the wrong heading.

**B3. The backend ignores everything the user steers.**
`generate-document` is a POST with NO body (controller L93-96). The frontend persists
`whitepaper_steer_note`, `whitepaper_tone`, and `whitepaper_context_items` into formData,
but `generateDocument()` never reads them. Tone selector, steer note, and the context
checkboxes have zero effect on output. The entire right-hand "Draft with Clio" panel is
decorative. (workflows.service.ts L431-708.)

### HIGH

**B4. No DOCX export — it exports a fake .doc.**
`exportDocument()` writes plain text into a Blob with a `.doc` extension and
`application/msword` mime. It is not a real Word file (no OOXML), styling is lost, and
some Word versions warn on open. (WhitePaperEditorPage.tsx L472-484.)

**B5. Section edits never persist to the canonical `generated_document` until autosave races.**
`generated_document` is recomputed from `composeDocument(sections)` only inside the
autosave mutation. The StrategyDashboard "View & Edit" vs "Generate" branching keys off
`generated_document` (StrategyDashboard.tsx L460), so a freshly hand-edited paper can show
stale dashboard state between debounced saves.

**B6. Context pool is shallow and partly placeholder.**
`contextPool` is built only from `formData.research_sources`, `formData.intel_digest`, and
strategy targets — fields that are rarely populated for a white-paper instance. When empty
it falls back to two cosmetic chips ("Client context", "White Paper"). There is no way to
attach real client meetings, email threads, capability records, prior submissions, or
free-form notes — even though the BACKEND already loads meetings/threads/capability for
generation (workflows.service.ts L465-586). The UI and backend context models are divorced.

### MEDIUM

**B7. Tone/steer/context are write-only.** Because of B3 they are saved but never consumed,
so they silently mislead the user into thinking they're shaping the draft.

**B8. "Rewrite" === "Draft with Clio".** Both buttons call the identical `generateOneSection`.
No distinct rewrite/refine behavior.

**B9. No timeout / provider fallback on the white-paper generation call.**
`generateDocument` uses a bare `fetch` to Anthropic with no `AbortController` and no
OpenAI fallback, unlike `EngagementAiService` (which has `fetchWithTimeout` + provider
fallback) and the chat service. A slow Anthropic call hangs the request to the platform's
default timeout.

**B10. Markers / placeholders not guaranteed clean.** The prompt template uses
`[Program Name]`, `[Fiscal Year]` bracket tokens; the system prompt says "don't invent"
but does not explicitly forbid leaving bracket placeholders, so generations can ship with
`[Program Name]` literally in the text.

**B11. No loading state on per-section generate** beyond a synchronous flag that flips back
immediately (B1 is synchronous), so the spinner never actually shows.

**B12. Word count / "section done" heuristics are crude** (`body.length > 40` chars =
"done"), which will mark a one-line stub as complete.

---

## PART 2 — ENHANCEMENT PLAN

Goal: turn this into a guided, agentic white-paper builder that (a) accepts rich context
like the outreach emails, (b) is driven through Clio with write-back to the paper, and
(c) reliably produces professional, structured, congressional-grade documents.

### Design principles
- Reuse what already works: `EngagementAiService`'s provider-fallback + `additionalContext`
  pattern, and the chat service's `editWorkflow` write-back seam.
- The white paper becomes a **structured, section-addressable document**, not one blob.
- Clio is the guide: it proposes structure, asks targeted questions, drafts section by
  section, and writes back into the exact section.

### Phase 0 — Data model (foundation)
- Define a canonical `whitepaper` shape in formData:
  `{ sections: [{id, heading, body, status}], tone, steerNote, contextItems: [...],
     templateVariant, generatedAt }`.
- `contextItems` becomes a first-class list (mirrors outreach `customContext` +
  selected insights): each item = `{id, kind, refId?, title, content}` where `kind` ∈
  {meeting, email_thread, capability, prior_submission, intel, research, freeform_note,
  uploaded_doc}.

### Phase 1 — Fix the core bugs (ship first)
1. **Real per-section AI** (kills B1/B8): add
   `POST /workflows/instances/:id/generate-section { sectionId, heading, instruction?,
   tone, steerNote, contextItemIds }` → returns drafted section body. Frontend writes the
   result into THAT section only. "Rewrite" passes `mode:'rewrite'` + existing body.
2. **Structured full draft** (kills B2): change `generateDocument` to return
   `{ sections: [{heading, body}] }` (JSON-schema'd, like outreach). Frontend maps each
   returned section to a section row instead of dumping into section 1.
3. **Wire steer/tone/context into the backend** (kills B3/B7): `generate-document` and
   `generate-section` accept a body with `tone`, `steerNote`, `contextItemIds`; the service
   resolves context items (meetings/threads/capability/notes) into context blocks and
   appends `Tone directive` + `Steer note` to the prompt. Add `fetchWithTimeout` +
   OpenAI fallback (kills B9). Add explicit "never leave bracket placeholders" rule (B10).
4. **Real DOCX export** (kills B4): generate true OOXML. Prefer a small server endpoint
   `GET /workflows/instances/:id/export.docx` using a docx lib (the repo already produces
   documents server-side) so headings/styles survive; fall back to the existing client path
   only if offline.
5. **Persist `generated_document` deterministically** (kills B5): recompute and PATCH on
   every section change via the existing debounce but also force-save before navigation /
   "Mark complete".

### Phase 2 — Rich context (the "like outreach emails" ask)
- New "Context" panel section: **"Add context"** with the same affordances as outreach:
  - pick from client meetings, email threads, capability/program record, prior submissions,
    intel insights (server-provided candidate list, scoped to the strategy's client);
  - paste a **free-form note** (the outreach `additionalContext` equivalent);
  - (stretch) upload a supporting doc → text-extracted into a context item.
- Backend: `GET /workflows/instances/:id/context-candidates` returns the resolvable items
  (reuse `clientMeetingAssociationWhere` / `clientMailThreadAssociationWhere` already in
  workflows.service.ts). Selected `contextItemIds` flow into generation (Phase 1.3).

### Phase 3 — Guided agentic experience (Clio-driven, writes back)
Decision: build it **into the existing Clio chat** (it already has intent routing,
provider fallback, and `editWorkflow` write-back) rather than a separate bot — this
satisfies "as long as it can write back to the white paper."

- Add chat intents + handlers:
  - `whitepaper_structure` — Clio proposes a section outline from a chosen **template
    variant** (see below) and the resolved context; user approves/edits → writes the
    `sections` skeleton back.
  - `whitepaper_draft_section` — drafts/refines a named section, writes back to that
    section (extends the existing `editWorkflow` persistence to target
    `whitepaper.sections[id].body`).
  - `whitepaper_interview` — Clio asks 2-4 targeted questions to fill gaps (e.g. "What's
    the FY27 ask amount?", "Which member's district is the nexus?") then drafts.
- Guided structure with options — offer 3 starting **templates/variants**, each with a
  recommended section set and tone default:
  1. **Congressional Program White Paper** (default): Problem Statement · Solution ·
     Current Status (TRL/milestones) · Funding History & Request · National Security
     Impact · Economic/District Impact · The Ask.
  2. **Appropriations Request Brief** (tighter, numbers-forward): The Ask · Funding
     Context (FY enacted/requested vs PBR) · Capability Gap · District/State Impact ·
     Accountability/Oversight.
  3. **Issue/Policy Position Paper** (narrative): Executive Summary · Background ·
     Policy Problem · Recommended Action · Stakeholders & Support · Call to Action.
- A guided wizard entry ("Start with Clio") on a blank paper: pick variant → confirm
  context → Clio interviews for gaps → drafts all sections → user reviews inline.

### Phase 4 — Quality & polish
- Section status model (`empty | drafted | reviewed`) replacing the >40-char heuristic (B12).
- Per-section "Improve" actions: tighten, add data/metrics, make district nexus explicit,
  cut to length.
- Live word/page budget per variant (e.g. warn when Program WP > 600 words).
- Final "Lint" pass: flag leftover bracket placeholders, unsupported claims, missing the
  Ask, and tone drift before "Mark complete".
- Export polish: branded DOCX header (client · program · FY), proper heading styles, PDF
  option.

### Suggested delivery order
- PR1 (bugs): Phase 1.1-1.3 + 1.5 — make generation real, structured, and steerable.
- PR2: Phase 1.4 real DOCX export.
- PR3: Phase 2 rich context (UI + candidates endpoint).
- PR4: Phase 3 Clio guided/agentic flow with write-back.
- PR5: Phase 4 quality/lint/polish.

Note: All AI generation here is content drafting (no auth/email/Outlook surface touched),
so it sits outside the hard guardrail. DB shape change is additive inside `formData` (JSON),
so no Prisma migration is required for the structured-sections model.
