from unittest.mock import patch

from fastapi.testclient import TestClient

from clio.main import app
from clio.models import ChatMessage, ChatResponse, TokenUsage


def test_healthz() -> None:
    client = TestClient(app)
    response = client.get("/healthz")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert "model" in body


def test_chat_happy_path() -> None:
    fake_response = ChatResponse(
        message=ChatMessage(role="assistant", content="hi five words there friend"),
        model="us.anthropic.claude-sonnet-4-6",
        stop_reason="end_turn",
        usage=TokenUsage(input_tokens=12, output_tokens=5),
    )
    with patch("clio.main.converse", return_value=fake_response) as mock:
        client = TestClient(app)
        response = client.post(
            "/chat",
            json={"messages": [{"role": "user", "content": "Say hi in 5 words."}]},
        )
    assert response.status_code == 200
    assert mock.called
    body = response.json()
    assert body["message"]["role"] == "assistant"
    assert body["usage"]["output_tokens"] == 5


def test_chat_validates_messages() -> None:
    client = TestClient(app)
    # Empty messages array should 422 on Pydantic min_length=1.
    response = client.post("/chat", json={"messages": []})
    assert response.status_code == 422
