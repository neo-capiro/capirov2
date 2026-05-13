"""Clio sandbox HTTP server.

Two endpoints:
    GET  /healthz   — liveness probe (ECS health check uses this).
    POST /run       — execute a Python program in the sandbox and
                       return stdout/stderr/exit_code/uploaded files.

Auth: shared-secret bearer token on /run. Same scheme as the Capiro
API ↔ Clio runtime contract — symmetry keeps the auth model uniform.
"""

from __future__ import annotations

import hmac
from contextlib import asynccontextmanager

import structlog
from fastapi import FastAPI, HTTPException, Request
from pydantic import BaseModel, Field

from .config import settings
from .runner import cleanup, run_user_code
from .storage import upload_outputs

log = structlog.get_logger(__name__)


class RunRequest(BaseModel):
    runId: str = Field(..., min_length=1, max_length=128)  # noqa: N815
    tenantId: str = Field(..., min_length=1, max_length=128)  # noqa: N815
    userId: str = Field(..., min_length=1, max_length=128)  # noqa: N815
    code: str = Field(..., min_length=1, max_length=64_000)
    title: str = Field(default="Untitled run", max_length=200)


class RunResponseFile(BaseModel):
    name: str
    contentType: str  # noqa: N815
    sizeBytes: int  # noqa: N815
    s3Key: str  # noqa: N815
    url: str


class RunResponse(BaseModel):
    stdout: str
    stderr: str
    exitCode: int  # noqa: N815
    durationMs: int  # noqa: N815
    files: list[RunResponseFile]


@asynccontextmanager
async def lifespan(app: FastAPI):
    structlog.configure(
        wrapper_class=structlog.make_filtering_bound_logger(
            __import__("logging").getLevelName(settings.log_level)
        ),
        processors=[
            structlog.processors.add_log_level,
            structlog.processors.TimeStamper(fmt="iso", utc=True),
            structlog.processors.JSONRenderer(),
        ],
    )
    log.info(
        "sandbox_boot",
        bind=f"{settings.bind_host}:{settings.bind_port}",
        assets_bucket=settings.assets_bucket or "(unset)",
        run_timeout_s=settings.run_timeout_seconds,
        run_memory_mb=settings.run_memory_mb,
    )
    yield


app = FastAPI(title="clio-sandbox", lifespan=lifespan)


@app.get("/healthz")
def healthz() -> dict[str, str]:
    return {"status": "ok"}


def _check_auth(request: Request) -> None:
    if not settings.inbound_shared_secret:
        # Fail closed — same posture as the Capiro API's
        # ClioInternalAuthGuard. If ops forgot to wire the secret,
        # don't accept anonymous traffic just because.
        raise HTTPException(status_code=401, detail="Unauthorized")
    auth = request.headers.get("authorization", "")
    if not auth.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Unauthorized")
    presented = auth[7:]
    if not hmac.compare_digest(presented, settings.inbound_shared_secret):
        raise HTTPException(status_code=401, detail="Unauthorized")


@app.post("/run", response_model=RunResponse)
def run(request: Request, body: RunRequest) -> RunResponse:
    _check_auth(request)
    log.info(
        "run_received",
        run_id=body.runId,
        tenant_id=body.tenantId,
        user_id=body.userId,
        code_len=len(body.code),
        title=body.title,
    )
    result = run_user_code(body.code, run_id=body.runId)
    try:
        uploaded = upload_outputs(
            result.workdir / "output",
            tenant_id=body.tenantId,
            run_id=body.runId,
        )
    except Exception as exc:  # noqa: BLE001
        log.warning("upload_failed", run_id=body.runId, error=str(exc))
        uploaded = []
    finally:
        cleanup(result.workdir)

    # Log stderr / exit code on non-success so we can diagnose user-code
    # failures from CloudWatch without having to ECS-exec into the task.
    # Truncate to 2KB to keep log lines bounded.
    if result.exit_code != 0:
        log.warning(
            "run_failed",
            run_id=body.runId,
            tenant_id=body.tenantId,
            exit_code=result.exit_code,
            duration_ms=result.duration_ms,
            stderr=result.stderr[:2048],
            stdout=result.stdout[:512],
            files=len(uploaded),
        )
    else:
        log.info(
            "run_finished",
            run_id=body.runId,
            tenant_id=body.tenantId,
            exit_code=result.exit_code,
            duration_ms=result.duration_ms,
            files=len(uploaded),
        )
    return RunResponse(
        stdout=result.stdout,
        stderr=result.stderr,
        exitCode=result.exit_code,
        durationMs=result.duration_ms,
        files=[
            RunResponseFile(
                name=f.name,
                contentType=f.content_type,
                sizeBytes=f.size_bytes,
                s3Key=f.s3_key,
                url=f.url,
            )
            for f in uploaded
        ],
    )
