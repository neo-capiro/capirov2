# Clio agent runtime

Capiro's in-house AI agent service. Hermes-influenced architecture, but a clean Capiro-owned implementation. Runs on AWS ECS Fargate, talks to Bedrock, integrates back to Capiro through the NestJS API for tool execution and tenancy.

## Why a separate service

The Capiro API (NestJS) is the system of record for tenants, users, auth, and audit. It must never block on a long-running LLM call. Clio runs in its own Fargate task so:

- Slow agent loops never tie up API Fargate workers
- Agent crashes don't take the API down
- The Python ML/agent ecosystem is available without polluting the TypeScript runtime
- Future per-user isolation (one Fargate task per active user) is a config change, not a refactor

## What's here today (Phase 0)

- `POST /chat` — single-turn Bedrock Converse pass-through. Takes a list of messages, calls `us.anthropic.claude-sonnet-4-6` by default, returns the assistant message + token usage.
- `GET /healthz` — used by ECS + ALB target group health checks.
- No session persistence, no tool-calling loop, no streaming yet — those come in Phases 2–4.

## Local development

```bash
cd apps/clio
uv sync
AWS_PROFILE=capiro-dev uv run uvicorn clio.main:app --reload
```

Then:

```bash
curl -X POST http://localhost:8000/chat \
  -H 'content-type: application/json' \
  -d '{"messages":[{"role":"user","content":"Say hi in 5 words."}]}'
```

The local boto3 client picks up creds from `AWS_PROFILE` (or env vars / instance role in ECS).

## Container build

The Dockerfile expects the **repository root** as build context — same convention as `apps/api/Dockerfile`. Run from the repo root:

```bash
docker buildx build --platform linux/arm64 \
  -f apps/clio/Dockerfile \
  -t 967807252336.dkr.ecr.us-east-1.amazonaws.com/capiro/staging/clio:latest \
  --push .
```

## Configuration

All settings are env vars prefixed `CLIO_`. Defaults are in `src/clio/config.py`. Production overrides come from the ECS task definition.

| Env var | Default | Notes |
|---|---|---|
| `CLIO_BEDROCK_REGION` | `us-east-1` | |
| `CLIO_BEDROCK_MODEL_ID` | `us.anthropic.claude-sonnet-4-6` | Cross-region inference profile |
| `CLIO_BEDROCK_MAX_TOKENS` | `4096` | |
| `CLIO_BEDROCK_TEMPERATURE` | `0.7` | |
| `CLIO_LOG_LEVEL` | `INFO` | structlog JSON output |
| `CLIO_CAPIRO_API_BASE_URL` | _empty_ | Set in Phase 4 when tool callbacks land |
| `CLIO_INBOUND_SHARED_SECRET` | _empty_ | Set in Phase 1 from Secrets Manager |

## What it doesn't do

This service is intentionally narrow. It never:

- Reads or writes Aurora directly — that's the Capiro API's job
- Holds long-lived secrets — IAM role grants Bedrock invoke; everything else is per-request
- Talks to the public internet — runs on a private subnet behind an internal ALB
- Persists session state locally — stateless across requests
