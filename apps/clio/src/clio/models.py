from typing import Any, Literal

from pydantic import BaseModel, Field


class ChatMessage(BaseModel):
    role: Literal["user", "assistant", "system"]
    content: str


class ToolDefinition(BaseModel):
    """Capiro API-supplied tool definition. Shape matches the Bedrock
    Converse `toolConfig.tools[].toolSpec` minus the wrapping — the agent
    loop adds the `toolSpec` wrapper when forwarding to Bedrock."""

    name: str
    description: str
    # camelCase to match the JSON the API sends (which in turn mirrors
    # Bedrock's `toolSpec.inputSchema` field). Renaming to snake_case
    # would force an alias and an extra config flag for no real benefit.
    inputSchema: dict[str, Any]  # noqa: N815


class ChatRequest(BaseModel):
    messages: list[ChatMessage] = Field(min_length=1)
    # Optional per-request override of the default model.
    model: str | None = None
    # Optional per-request system prompt; if provided, prepended ahead of any
    # `system` entries already in messages.
    system: str | None = None
    max_tokens: int | None = None
    temperature: float | None = None
    # Capiro session id. Required when `tools` are present — the agent loop
    # echoes it on every tool callback so the API can scope tenant on its
    # side. The runtime never persists or reads it itself.
    session_id: str | None = None
    # When non-empty, /chat runs the agent loop instead of a single-turn
    # pass-through: Bedrock → tool_use → callback to Capiro → tool_result →
    # Bedrock, until end_turn (or the iteration cap is hit).
    tools: list[ToolDefinition] | None = None


class TokenUsage(BaseModel):
    input_tokens: int
    output_tokens: int


class ToolCallSummary(BaseModel):
    """One row per tool the agent loop dispatched, in order. Surfaced
    back to the API so it can render a "what Clio did" audit trail and
    bill the round trip correctly."""

    name: str
    status: Literal["ok", "error"]
    duration_ms: int


class ChatResponse(BaseModel):
    message: ChatMessage
    model: str
    stop_reason: str
    usage: TokenUsage
    tool_calls: list[ToolCallSummary] | None = None
