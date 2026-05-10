from functools import cache
from typing import Any

import boto3
import structlog
from botocore.exceptions import ClientError

from .config import settings
from .models import ChatMessage, ChatResponse, TokenUsage

log = structlog.get_logger(__name__)


@cache
def _client() -> Any:
    # Cached at module level so we don't create a new boto session per request.
    # boto3 clients are thread-safe; FastAPI runs handlers in a threadpool by
    # default so a single shared client is correct.
    return boto3.client("bedrock-runtime", region_name=settings.bedrock_region)


def _split_system(messages: list[ChatMessage], extra_system: str | None) -> tuple[
    list[dict[str, str]], list[dict[str, Any]],
]:
    # Bedrock Converse splits `system` blocks from the conversational
    # `messages` list. Anything with role=system goes into the system array;
    # extra_system (from the request body) is prepended ahead of any
    # in-message system entries so per-request guidance wins precedence.
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


def converse(
    messages: list[ChatMessage],
    *,
    model: str | None = None,
    system: str | None = None,
    max_tokens: int | None = None,
    temperature: float | None = None,
) -> ChatResponse:
    model_id = model or settings.bedrock_model_id
    system_blocks, bedrock_messages = _split_system(messages, system)

    inference_config: dict[str, Any] = {
        "maxTokens": max_tokens or settings.bedrock_max_tokens,
        "temperature": temperature if temperature is not None else settings.bedrock_temperature,
    }

    try:
        response = _client().converse(
            modelId=model_id,
            messages=bedrock_messages,
            system=system_blocks if system_blocks else [],
            inferenceConfig=inference_config,
        )
    except ClientError as e:
        # AccessDeniedException, ValidationException, ResourceNotFoundException,
        # ThrottlingException all surface here. Re-raise so the route handler
        # maps them to the right HTTP status with a redacted message.
        log.error("bedrock_converse_failed", model=model_id, error=str(e))
        raise

    output_message = response["output"]["message"]
    # Converse returns content as an array of blocks; for plain text turns
    # there's exactly one text block. Concatenate to be robust to future
    # multi-block responses.
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
