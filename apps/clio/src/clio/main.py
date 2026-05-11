import logging

import structlog
from botocore.exceptions import ClientError
from fastapi import FastAPI, HTTPException, Request, status
from fastapi.responses import JSONResponse

from . import __version__
from .agent_loop import AgentLoopError, run_agent_loop
from .bedrock import converse
from .config import settings
from .models import ChatRequest, ChatResponse


def _configure_logging() -> None:
    logging.basicConfig(level=settings.log_level)
    structlog.configure(
        processors=[
            structlog.contextvars.merge_contextvars,
            structlog.processors.add_log_level,
            structlog.processors.TimeStamper(fmt="iso"),
            structlog.processors.JSONRenderer(),
        ],
    )


_configure_logging()
log = structlog.get_logger(__name__)

app = FastAPI(
    title="Capiro Clio",
    version=__version__,
    docs_url="/docs",
    redoc_url=None,
)


@app.get("/healthz")
def healthz() -> dict[str, str]:
    return {"status": "ok", "version": __version__, "model": settings.bedrock_model_id}


@app.post("/chat", response_model=ChatResponse)
def chat(req: ChatRequest) -> ChatResponse:
    has_tools = bool(req.tools)
    log.info(
        "chat_received",
        message_count=len(req.messages),
        model=req.model or settings.bedrock_model_id,
        tool_count=len(req.tools) if req.tools else 0,
        session_id=req.session_id,
    )
    try:
        # Two paths: when tools are passed we run the agent loop (which
        # may call back to Capiro multiple times before returning). When
        # no tools are passed it's a single-turn pass-through.
        if has_tools:
            return run_agent_loop(
                req.messages,
                tools=req.tools or [],
                session_id=req.session_id or "",
                model=req.model,
                system=req.system,
                max_tokens=req.max_tokens,
                temperature=req.temperature,
            )
        return converse(
            req.messages,
            model=req.model,
            system=req.system,
            max_tokens=req.max_tokens,
            temperature=req.temperature,
        )
    except AgentLoopError as e:
        # Misconfigured request (missing session_id, base URL, etc.)
        raise HTTPException(status_code=400, detail=str(e)) from e
    except ClientError as e:
        code = e.response.get("Error", {}).get("Code", "")
        if code in ("ValidationException", "ResourceNotFoundException"):
            raise HTTPException(status_code=400, detail="Invalid request to model provider") from e
        if code == "AccessDeniedException":
            raise HTTPException(status_code=403, detail="Model access denied") from e
        if code in ("ThrottlingException", "ServiceUnavailableException"):
            raise HTTPException(status_code=503, detail="Model provider unavailable") from e
        raise HTTPException(status_code=502, detail="Model provider error") from e


@app.exception_handler(Exception)
async def unhandled_exception(request: Request, exc: Exception) -> JSONResponse:
    log.exception("unhandled_error", path=request.url.path)
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={"detail": "Internal server error"},
    )
