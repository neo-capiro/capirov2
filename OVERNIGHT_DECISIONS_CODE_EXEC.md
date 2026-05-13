# §16. Code execution + native file generation — design spec

You asked: Clio should be able to write a Python function, run it, hand you back an Excel/Word/PPT/etc file. That's a single feature — a sandboxed code interpreter — with file artifacts as the output.

## Why this is one feature, not two

If we build a sandbox where the model can write arbitrary Python, then "make an Excel" is just "model writes openpyxl code, run it, S3 the file". Same for Word (`python-docx`), PowerPoint (`python-pptx`), PDF (`reportlab`), images (`Pillow`), data analysis (`pandas`), API calls (`requests`). One feature unlocks dozens of capabilities — exactly how Hermes and Claude.ai's code interpreter work.

The alternative — building rigid Excel/Word/PPT template tools — is brittle and forces the model into a tiny pre-defined shape. Worse for the user, worse for us to maintain.

## Architecture

```
       ┌──────────┐    /chat     ┌──────────────┐
       │  Capiro  │ ───────────▶ │  Clio agent  │
       │   API    │              │   runtime    │
       └──────────┘              └──────┬───────┘
                                        │ Bedrock /converse
                                        │ tool_use: code_interpreter
                                        ▼
                                 ┌──────────────┐
                                 │  agent_loop  │
                                 └──────┬───────┘
                                        │ POST /api/clio/internal/tools/code_interpreter
                                        ▼
                                 ┌──────────────┐    POST /run    ┌──────────────────┐
                                 │  Capiro API  │ ──────────────▶ │  clio-sandbox    │
                                 │ (auth+route) │                 │  (NEW Fargate)   │
                                 └──────────────┘                 │                  │
                                                                  │  pyrunner.py     │
                                                                  │  exec in subprocess
                                                                  │  --timeout 30s   │
                                                                  │  --rlimit mem 512│
                                                                  │  no network     │
                                                                  │  except allowlist│
                                                                  └────────┬─────────┘
                                                                           │ files
                                                                           ▼
                                                                  ┌────────────────┐
                                                                  │  Assets S3     │
                                                                  │ tenants/<id>/  │
                                                                  │  clio-runs/    │
                                                                  └────────────────┘
```

### New service: `clio-sandbox`

Separate ECS Fargate task. Sister to `clio` but isolated:
- Different IAM role (write to `assets/tenants/*/clio-runs/*` only; no Bedrock, no Secrets Manager).
- Different security group (egress allow-list: S3, public REST endpoints we curate, and that's it).
- `readonlyRootFilesystem: true` with a small ephemeral `/tmp/<run>` for working files.
- One Python process per task (uvicorn FastAPI). Each `/run` opens a subprocess.

**Why a separate task instead of in Clio:** a code-exec compromise must not steal Bedrock keys or the Capiro shared secret. The sandbox runs as an untrusted-code executor; the agent runtime is trusted infra. Putting them in the same task collapses that boundary.

### The `code_interpreter` tool

Bedrock toolConfig shape:

```jsonc
{
  "name": "code_interpreter",
  "description": "Run a short Python program in a sandboxed environment to compute, transform data, fetch from public APIs, or generate files (Excel, Word, PowerPoint, PDF, images, JSON). Files written to /tmp/output/ are auto-uploaded and returned as downloadable artifacts. Stdout/stderr are returned to you. Use this for any task that needs computation, file generation, or non-trivial data work.",
  "inputSchema": {
    "type": "object",
    "required": ["code"],
    "properties": {
      "code": {
        "type": "string",
        "description": "Self-contained Python program. Pre-imported libraries: pandas, openpyxl, python-docx, python-pptx, reportlab, requests, Pillow, json, csv, re, math, datetime. Write file outputs into /tmp/output/<filename>. No filesystem access outside /tmp."
      },
      "title": {
        "type": "string",
        "description": "Short human-friendly label for the run, shown in the artifact panel."
      }
    }
  }
}
```

Tool implementation on the API side (`apps/api/src/clio/tools/code-interpreter.tool.ts`):

1. POST to `http://clio-sandbox.capiro-staging.local:8001/run` with `{ code, title, runId }` and the shared bearer secret.
2. Sandbox executes, writes outputs to its local `/tmp/output/`, uploads each to `s3://assets/tenants/<tenantId>/clio-runs/<runId>/<filename>`.
3. Sandbox returns `{ stdout, stderr, exitCode, durationMs, files: [{ name, contentType, sizeBytes, s3Key }] }`.
4. API mints presigned-GET URLs for each S3 key (15-minute expiry) and stores `clio_artifact` rows with `kind='code_run'` so the artifact panel surfaces them.
5. Tool result back to the model: stdout (truncated to 4KB) + stderr (truncated to 2KB) + file list with URLs.

### Pre-installed libraries

Image baked with:
- `pandas`, `numpy`, `openpyxl` (Excel)
- `python-docx` (Word), `python-pptx` (PowerPoint)
- `reportlab`, `pypdf` (PDF read/write)
- `Pillow` (images)
- `requests` (network calls — restricted egress)
- `beautifulsoup4`, `lxml` (HTML/XML parsing)
- stdlib: json, csv, re, math, datetime, base64, hashlib, urllib, etc.

Versions pinned in `apps/clio-sandbox/pyproject.toml`. Image size after pruning: ~600MB, acceptable for a Fargate task.

### Security model

What's blocked:
- Filesystem reads/writes outside `/tmp/<runId>/`. Enforced via `pivot_root` / `chroot` if available, or a strict path validator in the runner.
- Outbound network except a hardcoded allowlist of well-known APIs (initially: `api.openai.com`, `api.anthropic.com`, `api.github.com`, AWS S3 only — we'll grow this). All other requests fail with `ConnectionRefused`.
- Subprocess limits: 30s wall clock, 512MB memory (rlimit), 100% of one CPU, no fork/exec to other binaries.
- No access to environment variables (the sandbox sets a clean env for the child).
- No `eval(input())` games — the code is run with `python -c <code>`, no stdin.

What's allowed:
- Reading & writing `/tmp/<runId>/`.
- All stdlib + pre-installed libs above.
- Outbound to the allowlist.

### Per-tenant scope + accounting

- Each run logs `clio_code_runs` row (new table): tenantId, userId, sessionId, code (truncated to 8KB), durationMs, exitCode, fileCount, bytesOut.
- Hard cap: 10 runs/minute per user, 200 runs/day per tenant. Failing closed when over limit — error message to the model tells it to wait.
- Audit trail: every run is logged to CloudWatch with the user id so we can investigate misuse.

### File artifacts surfacing in the SPA

Already partly built: `clio_artifacts` table has `kind` enum, `s3Key`, `s3ContentType`. Adding the values: `excel_workbook`, `word_document`, `ppt_presentation`, `pdf_document`, `image`, `data_file`. The artifact panel already renders a downloadable card per artifact — we just need to give each kind a sensible icon (FileExcelOutlined, FileWordOutlined, FilePptOutlined, FilePdfOutlined, etc.).

### Cost & latency

- Cold start the sandbox task: ~5s (already in `running` state, just opens a subprocess).
- Typical run: 1-3s for a code execution + S3 upload.
- Steady state: one Fargate task at 0.25 vCPU + 512MB = ~$10/mo. Scale-out trigger: queue depth.

## What I scaffolded tonight (commit pending)

Even though I can't fully ship the sandbox without Docker, I'll commit:

1. **`code_interpreter` tool stub** in the API. Registers in `ToolRegistryService`, returns `{ ok: false, error: 'Sandbox not provisioned' }` until the env var `CLIO_SANDBOX_BASE_URL` is set. Frontend ribbon will show "⚠ code_interpreter (provisioning)" so you can see the tool wired without a working backend.
2. **Default system-prompt update** in both tiers introducing `code_interpreter` so the model knows it can reach for it.
3. **`apps/clio-sandbox/`** directory with:
   - `pyproject.toml` (libraries listed above)
   - `Dockerfile` (Python 3.11 slim, ARM64)
   - `src/sandbox/server.py` — FastAPI `/run` endpoint with subprocess + rlimit + S3 upload
   - `src/sandbox/runner.py` — the actual `subprocess.Popen` + resource limits
   - `README.md` with how to run locally
4. **CDK stub** in `infra/cdk/lib/sandbox-stack.ts` — task definition, service, security group, IAM role. Wired into the existing Network stack. Not deployed automatically.

## What's left for the next session

- Decide on egress allowlist (you).
- Decide on per-tenant rate limits (you).
- Build + push the sandbox image.
- Deploy `Capiro-staging-Sandbox` stack.
- Set `CLIO_SANDBOX_BASE_URL` env on the API task and flip the tool stub to call the real backend.
- Smoke test: ask Clio "give me an Excel of three columns: name, email, role with five sample rows" and watch the artifact appear.

That's ~3 hours focused work next session, all clearly bounded.
