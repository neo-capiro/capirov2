# §17. Web browsing + browser control

You said: fix web browsing and browser control. Two related capabilities; one ships tonight, one is spec'd for next session.

## Tonight: `fetch_url` shipped

The gap I closed: `web_search` returned snippets, but the agent couldn't actually READ the result pages. Now there's a `fetch_url` tool the model can chain after a search to read a specific URL.

Implementation:
- Pure server-side fetch from the API. No browser, no JS execution.
- HTML → text via minimal extractor (strip scripts/styles, replace block tags with newlines, decode entities, collapse whitespace). Good for ~80% of pages; the other 20% (heavy SPA / login-walled) need the Playwright path below.
- Defense in depth against SSRF: http(s) only, blocks `localhost` / IP literals / metadata endpoints / `*.local` / `*.internal` / `*.arpa`. Egress at the API task's SG layer is the real boundary.
- 2MB streaming size cap, 15s timeout, 5-redirect cap, content-type allowlist (text/HTML/JSON/XML — binary refused).
- Default 10k-char extracted-text cap (configurable up to 40k).
- Lives in [apps/api/src/clio/tools/fetch-url.tool.ts](apps/api/src/clio/tools/fetch-url.tool.ts).

System prompts updated to teach the model: `web_search` → `fetch_url` chain ("search returns hits, fetch_url reads them"). Direct URL queries from the user ("summarize https://...") go straight to `fetch_url`.

Verified end-to-end on Bedrock Claude 4.6 in next-build smoke test (pending current deploy).

## Next session: browser control via Playwright in the sandbox

The bigger ask. Real browser automation needs:
- A headless Chromium that can execute JS.
- A way to click, fill forms, follow multi-page flows, take screenshots.
- Session state that survives across tool calls in the same chat (so `open → navigate → fill → click → read` works as separate tool calls).

The cleanest path: **fold this into clio-sandbox.** That service is already designed as a code-execution boundary with rlimits + egress controls. Adding Playwright + Chromium to the image gives the agent two ways to use it:

### Path A — Code-interpreter-driven browser

Today `code_interpreter` runs arbitrary Python. Add `playwright` to the sandbox's pre-installed libs (~250MB on top of the current image; ships with Chromium). The model writes Python that does:

```python
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page()
    page.goto('https://example.com/login')
    page.fill('input[name=email]', 'me@capiro.ai')
    page.fill('input[name=password]', SECRET)
    page.click('button[type=submit]')
    page.wait_for_url('**/dashboard')
    print(page.inner_text('h1'))
    browser.close()
```

Pros: zero new tool surface. The model already knows Playwright's API. Output files (screenshots, downloaded docs) flow through the same `/tmp/output/` → S3 → presigned-URL pipeline.

Cons: every browser action is a fresh subprocess + browser launch (~2-3s overhead). Multi-step flows can't share state across model turns.

### Path B — Dedicated `browser_session` tool family

Persistent sessions with explicit tool calls:
- `browser_open()` — returns `sessionId`.
- `browser_navigate(sessionId, url)`.
- `browser_click(sessionId, selector)`.
- `browser_fill(sessionId, selector, value)`.
- `browser_get_text(sessionId, selector?)`.
- `browser_screenshot(sessionId)` — returns S3-uploaded PNG with presigned URL.
- `browser_close(sessionId)`.

Sandbox holds a Playwright instance per `sessionId` in a dict, garbage-collects after 10min idle. The agent can do multi-page flows without burning tokens on Python boilerplate.

Pros: Claude-style affordances. State persists across turns within a chat session. Lower-token tool calls.

Cons: more surface to maintain. Browser memory usage is real — one Fargate task can probably hold 3-5 concurrent sessions before pressure.

### Recommendation

Ship Path A first (one-line addition to the sandbox image's pyproject.toml + a paragraph in the system prompt). It unblocks the use case immediately. Add Path B in a follow-up only if we see the model struggling with multi-turn flows.

## Build steps for next session

1. Add `playwright==1.49.1` to `apps/clio-sandbox/pyproject.toml`.
2. Extend the Dockerfile with `RUN playwright install --with-deps chromium` after `uv sync`.
3. Update the sandbox runner's egress allowlist with whatever sites the user wants Clio browsing (e.g. `*.federalregister.gov`, `*.congress.gov`, common news sites).
4. Update `code_interpreter`'s tool description to mention Playwright is available.
5. (Path B) Add the six `browser_*` tools to the API, route them through the sandbox's persistent-session endpoint.
6. Smoke test: "log into senate.gov's lobbying database and pull last quarter's filings" — multi-step, JS-heavy, exactly the kind of task fetch_url can't do.

Image size after Playwright + Chromium: ~1.2GB. Acceptable; the task definition's container image size limit is much higher.

## Why not connect the existing Claude_in_Chrome MCP tools?

You and I already have those in this debugging session. But they're tied to your local Chrome — they don't run in the cluster. For Clio to operate when you're not at the keyboard (responding to inbound mail, working on a scheduled task), it needs its own browser in the cluster. The Playwright-in-sandbox path is that.
