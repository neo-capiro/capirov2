from functools import cache
from typing import Any

import boto3
import structlog
from botocore.exceptions import ClientError

from .config import settings
from .models import ChatMessage, ChatResponse, TokenUsage, ToolDefinition

log = structlog.get_logger(__name__)


@cache
def _client() -> Any:
    # Cached at module level so we don't create a new boto session per request.
    # boto3 clients are thread-safe; FastAPI runs handlers in a threadpool by
    # default so a single shared client is correct.
    return boto3.client("bedrock-runtime", region_name=settings.bedrock_region)


def split_system(messages: list[ChatMessage], extra_system: str | None) -> tuple[
    list[dict[str, str]], list[dict[str, Any]],
]:
    """Split Capiro-shaped messages into Bedrock's (system_blocks, messages)
    pair. The agent loop calls this on the first turn and then mutates the
    messages list directly across iterations (appending assistant + tool
    result rows) without re-running the splitter."""
    system_blocks: list[dict[str, str]] = []
    if extra_system:
        system_blocks.append({"text": extra_system})

    bedrock_messages: list[dict[str, Any]] = []
    for m in messages:
        if m.role == "system":
            system_blocks.append({"text": m.content})
            continue
        bedrock_messages.append({"role": m.role, "content": [{"text": m.content}]})
    return system_blocks, bedrock_messages


def build_tool_config(tools: list[ToolDefinition]) -> dict[str, Any]:
    """Bedrock Converse takes tools in a specific shape: each entry is
    wrapped in `toolSpec` and the schema goes under `inputSchema.json`."""
    return {
        "tools": [
            {
                "toolSpec": {
                    "name": t.name,
                    "description": t.description,
                    "inputSchema": {"json": t.inputSchema},
                }
            }
            for t in tools
        ]
    }


def converse_raw(
    bedrock_messages: list[dict[str, Any]],
    system_blocks: list[dict[str, str]],
    *,
    model: str | None = None,
    max_tokens: int | None = None,
    temperature: float | None = None,
    tool_config: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Low-level Converse call. Returns the raw Bedrock response so the
    agent loop can inspect `stopReason` + the structured content blocks
    (including `toolUse`) directly."""
    model_id = model or settings.bedrock_model_id
    inference_config: dict[str, Any] = {
        "maxTokens": max_tokens or settings.bedrock_max_tokens,
        "temperature": temperature if temperature is not None else settings.bedrock_temperature,
    }
    kwargs: dict[str, Any] = {
        "modelId": model_id,
        "messages": bedrock_messages,
        "inferenceConfig": inference_config,
    }
    if system_blocks:
        kwargs["system"] = system_blocks
    if tool_config:
        kwargs["toolConfig"] = tool_config

    try:
        return _client().converse(**kwargs)
    except ClientError as e:
        # Surface the underlying error code in the structured log so the
        # ops dashboard can split throttling vs access denied vs validation.
        log.error(
            "bedrock_converse_failed",
            model=model_id,
            error=str(e),
            code=e.response.get("Error", {}).get("Code", ""),
        )
        raise


def converse(
    messages: list[ChatMessage],
    *,
    model: str | None = None,
    system: str | None = None,
    max_tokens: int | None = None,
    temperature: float | None = None,
) -> ChatResponse:
    """Single-turn pass-through. The agent loop uses converse_raw directly;
    /chat falls back to this when no tools are passed."""
    model_id = model or settings.bedrock_model_id
    system_blocks, bedrock_messages = split_system(messages, system)
    response = converse_raw(
        bedrock_messages,
        system_blocks,
        model=model_id,
        max_tokens=max_tokens,
        temperature=temperature,
    )
    output_message = response["output"]["message"]
    text = "".join(block.get("text", "") for block in output_message["content"] if "text" in block)
    return ChatResponse(
        message=ChatMessage(role=output_message["role"], content=text),
        model=model_id,
        stop_reason=response.get("stopReason", "end_turn"),
        usage=TokenUsage(
            input_tokens=response["usage"]["inputTokens"],
            output_tokens=response["usage"]["outputTokens"],
        ),
    )
