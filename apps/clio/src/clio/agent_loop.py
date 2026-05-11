"""Tool-use agent loop.

When `/chat` is called with a `tools` array, this module drives the
multi-turn cycle:

    1. Bedrock converse with toolConfig → assistant message
    2. If stopReason == "tool_use", extract toolUse block(s)
    3. POST to Capiro /api/clio/internal/tools/{name} with sessionId + input
    4. Append the assistant message AND a user message carrying toolResult
       blocks to the running message list
    5. Loop

Hard caps: MAX_ITERATIONS prevents an agent from looping forever; the
token usage cap is enforced by Bedrock's inferenceConfig.maxTokens
per-turn (no Capiro-side global cap yet — Phase 7 problem).

Tool callbacks are SYNCHRONOUS HTTPS to the Capiro public ALB. Going
through the public ALB rather than internal Cloud Map keeps the cert
path simple — both services live in the same VPC so the extra hop is
fast (~3ms) and the API's existing ALB WAF/throttling apply.
"""

from __future__ import annotations

import time
from typing import Any

import httpx
import structlog

from .bedrock import build_tool_config, converse_raw, split_system
from .config import settings
from .models import (
    ChatMessage,
    ChatResponse,
    TokenUsage,
    ToolCallSummary,
    ToolDefinition,
)

log = structlog.get_logger(__name__)

# Most legitimate agent tasks finish in 1–3 tool hops. Six gives us
# headroom for chained "look up client → search filings → check meeting"
# style flows without letting a confused agent burn an unbounded number
# of Bedrock turns.
MAX_ITERATIONS = 6


class AgentLoopError(RuntimeError):
    """Raised when the loop cannot continue — bad session id, missing
    config, network failure on a tool callback, etc."""


def run_agent_loop(
    messages: list[ChatMessage],
    *,
    tools: list[ToolDefinition],
    session_id: str,
    model: str | None = None,
    system: str | None = None,
    max_tokens: int | None = None,
    temperature: float | None = None,
) -> ChatResponse:
    if not session_id:
        raise AgentLoopError("session_id is required when tools are provided")
    if not settings.capiro_api_base_url:
        raise AgentLoopError("CLIO_CAPIRO_API_BASE_URL not configured")
    if not settings.inbound_shared_secret:
        raise AgentLoopError("CLIO_INBOUND_SHARED_SECRET not configured")

    system_blocks, bedrock_messages = split_system(messages, system)
    tool_config = build_tool_config(tools)

    tool_calls: list[ToolCallSummary] = []
    total_in = 0
    total_out = 0
    last_text = ""
    final_stop = "end_turn"

    with httpx.Client(
        base_url=settings.capiro_api_base_url,
        timeout=30.0,
        headers={
            "authorization": f"Bearer {settings.inbound_shared_secret}",
            "content-type": "application/json",
        },
    ) as client:
        for _ in range(MAX_ITERATIONS):
            response = converse_raw(
                bedrock_messages,
                system_blocks,
                model=model,
                max_tokens=max_tokens,
                temperature=temperature,
                tool_config=tool_config,
            )
            total_in += response["usage"]["inputTokens"]
            total_out += response["usage"]["outputTokens"]
            stop_reason = response.get("stopReason", "end_turn")
            final_stop = stop_reason
            assistant_msg = response["output"]["message"]
            content_blocks: list[dict[str, Any]] = assistant_msg["content"]

            # Always append the assistant message before doing anything else
            # — Bedrock requires the next user-role message (with
            # toolResult) to follow the exact assistant message that
            # produced the toolUse, including any text blocks before it.
            bedrock_messages.append({"role": "assistant", "content": content_blocks})

            # Extract whatever text the assistant gave us this turn so the
            # final response can surface it even if subsequent turns
            # return purely structured content.
            text_blocks = [b.get("text", "") for b in content_blocks if "text" in b]
            if text_blocks:
                last_text = "".join(text_blocks)

            if stop_reason != "tool_use":
                break

            # Execute every toolUse block in this turn; Bedrock can issue
            # several in a single response if it wants to fan-out lookups.
            tool_result_content: list[dict[str, Any]] = []
            for block in content_blocks:
                tu = block.get("toolUse")
                if not tu:
                    continue
                tool_name = tu["name"]
                tool_use_id = tu["toolUseId"]
                tool_input = tu.get("input", {}) or {}
                started = time.perf_counter()
                try:
                    output = _invoke_tool(client, tool_name, session_id, tool_input)
                    duration_ms = int((time.perf_counter() - started) * 1000)
                    tool_calls.append(
                        ToolCallSummary(name=tool_name, status="ok", duration_ms=duration_ms)
                    )
                    # Bedrock wants a structured result back. Wrapping as
                    # {json: ...} keeps Claude reading it as data, not as
                    # a string blob it has to re-parse.
                    tool_result_content.append(
                        {"toolResult": {"toolUseId": tool_use_id, "content": [{"json": output}]}}
                    )
                except Exception as e:  # noqa: BLE001 — we map every failure mode to a tool error
                    duration_ms = int((time.perf_counter() - started) * 1000)
                    tool_calls.append(
                        ToolCallSummary(
                            name=tool_name, status="error", duration_ms=duration_ms
                        )
                    )
                    log.warning(
                        "tool_invoke_failed",
                        tool=tool_name,
                        session_id=session_id,
                        error=str(e),
                    )
                    tool_result_content.append(
                        {
                            "toolResult": {
                                "toolUseId": tool_use_id,
                                "content": [{"text": f"Tool failed: {e}"}],
                                "status": "error",
                            }
                        }
                    )

            bedrock_messages.append({"role": "user", "content": tool_result_content})

        else:
            # Loop exhausted MAX_ITERATIONS without an end_turn — surface
            # a recognizable stop reason so the API can flag it.
            final_stop = "max_iterations"
            log.warning(
                "agent_loop_max_iterations",
                session_id=session_id,
                iterations=MAX_ITERATIONS,
            )

    return ChatResponse(
        message=ChatMessage(role="assistant", content=last_text),
        model=model or settings.bedrock_model_id,
        stop_reason=final_stop,
        usage=TokenUsage(input_tokens=total_in, output_tokens=total_out),
        tool_calls=tool_calls if tool_calls else None,
    )


def _invoke_tool(
    client: httpx.Client, tool_name: str, session_id: str, tool_input: dict[str, Any]
) -> Any:
    """POST to the Capiro internal tool route. Returns the parsed
    `output` field on success; raises on any non-2xx or network failure
    so the agent loop can record it as a tool error."""
    response = client.post(
        f"/clio/internal/tools/{tool_name}",
        json={"sessionId": session_id, "input": tool_input},
    )
    response.raise_for_status()
    body = response.json()
    # The API wraps results as {"output": ...}; unwrap here so the model
    # sees the raw payload it asked for.
    return body.get("output", body)
