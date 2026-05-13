# clio-sandbox

Sandboxed Python code execution + file artifact upload for the Clio
agent. Sister Fargate service to `apps/clio`. The agent's
`code_interpreter` tool calls `POST /run` here.

See [OVERNIGHT_DECISIONS_CODE_EXEC.md §16](../../OVERNIGHT_DECISIONS_CODE_EXEC.md)
for the full architecture and security model.

## Run locally

```bash
cd apps/clio-sandbox
uv sync
SANDBOX_INBOUND_SHARED_SECRET=local-dev-secret \
SANDBOX_ASSETS_BUCKET=capiro-staging-assets \
uv run uvicorn sandbox.server:app --host 0.0.0.0 --port 8001
```

Smoke test:

```bash
curl -sX POST http://localhost:8001/run \
  -H 'authorization: Bearer local-dev-secret' \
  -H 'content-type: application/json' \
  -d '{
    "runId":"test-1",
    "tenantId":"abc",
    "userId":"def",
    "code":"with open(\"/tmp/output/hello.txt\",\"w\") as f: f.write(\"hi\")\nprint(\"ok\")",
    "title":"hello world"
  }' | jq
```

## Endpoints

`GET /healthz` — liveness probe. Returns `{"status":"ok"}`.

`POST /run` — bearer-auth required. Body: `{runId, tenantId, userId, code, title}`.
Returns `{stdout, stderr, exitCode, durationMs, files: [{name, contentType, sizeBytes, s3Key, url}]}`.

## Security boundary

The sandbox is a separate Fargate task on purpose. It runs untrusted
user-submitted Python; a compromise here must not steal Bedrock keys
or the Capiro API shared secret. Its IAM role is restricted to
`s3:PutObject` on `assets/tenants/*/clio-runs/*`. Its security group
has an egress allowlist. Subprocess limits are enforced via
`resource.setrlimit` in `runner.py`.

## What's NOT done yet

This is the runtime. Still to do before the tool is live:

- CDK `Capiro-{env}-Sandbox` stack (security group, task definition,
  service, IAM role with the scoped S3 policy, Cloud Map registration).
- API task gets `CLIO_SANDBOX_BASE_URL=http://clio-sandbox.capiro-{env}.local:8001`.
- ECR repo `capiro/{env}/clio-sandbox`.
- Image build pushed to that repo.

See OVERNIGHT_DECISIONS_CODE_EXEC.md §16 for the deploy plan.
