from typing import Literal

from pydantic import BaseModel, Field


class ChatMessage(BaseModel):
    role: Literal["user", "assistant", "system"]
    content: str


class ChatRequest(BaseModel):
    messages: list[ChatMessage] = Field(min_length=1)
    # Optional per-request override of the default model.
    model: str | None = None
    # Optional per-request system prompt; if provided, prepended ahead of any
    # `system` entries already in messages.
    system: str | None = None
    max_tokens: int | None = None
    temperature: float | None = None


class TokenUsage(BaseModel):
    input_tokens: int
    output_tokens: int


class ChatResponse(BaseModel):
    message: ChatMessage
    model: str
    stop_reason: str
    usage: TokenUsage
