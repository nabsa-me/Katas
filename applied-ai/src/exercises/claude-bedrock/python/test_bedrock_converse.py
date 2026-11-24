import logging

import boto3
import pytest
from botocore.stub import ANY, Stubber

from bedrock_converse import (
    DEFAULT_MODEL_ID,
    SYSTEM_PROMPT,
    BedrockSettings,
    ConversationError,
    converse,
    create_client,
    stream_answer,
)

QUESTION = "What is the status of PLAT-104 and who is on it?"
SETTINGS = BedrockSettings(region="us-east-1", max_tokens=1024)
GET_PLAT_104 = {"toolUse": {"toolUseId": "tooluse-plat-104", "name": "get_issue", "input": {"key": "PLAT-104"}}}


def reply(stop_reason, content, input_tokens=400, output_tokens=60):
    return {
        "output": {"message": {"role": "assistant", "content": content}},
        "stopReason": stop_reason,
        "usage": {
            "inputTokens": input_tokens,
            "outputTokens": output_tokens,
            "totalTokens": input_tokens + output_tokens,
        },
        "metrics": {"latencyMs": 900},
    }


@pytest.fixture
def client():
    # Fake static credentials: the Stubber answers before anything is signed or sent.
    return boto3.client(
        "bedrock-runtime",
        region_name="us-east-1",
        aws_access_key_id="replace-with-a-fake-key-id",
        aws_secret_access_key="replace-with-a-fake-secret",
    )


def test_tool_loop_runs_the_tool_and_returns_the_final_answer(client, caplog):
    first_request = {
        "modelId": DEFAULT_MODEL_ID,
        "system": [{"text": SYSTEM_PROMPT}],
        "messages": [{"role": "user", "content": [{"text": QUESTION}]}],
        "inferenceConfig": {"maxTokens": 1024},
        "toolConfig": ANY,
    }
    second_messages = [
        {"role": "user", "content": [{"text": QUESTION}]},
        {"role": "assistant", "content": [{"text": "Let me look that up."}, GET_PLAT_104]},
        {"role": "user", "content": [{"toolResult": ANY}]},
    ]
    with Stubber(client) as stubber:
        stubber.add_response(
            "converse", reply("tool_use", [{"text": "Let me look that up."}, GET_PLAT_104]), first_request
        )
        stubber.add_response(
            "converse",
            reply("end_turn", [{"text": "PLAT-104 is In Progress, assigned to Mei Tanaka."}], 520, 45),
            {**first_request, "messages": second_messages},
        )
        with caplog.at_level(logging.INFO, logger="claude_bedrock"):
            result = converse(client, QUESTION, SETTINGS)
        stubber.assert_no_pending_responses()

    assert result.outcome == "answered"
    assert result.text == "PLAT-104 is In Progress, assigned to Mei Tanaka."
    assert result.model_calls == 2
    assert result.usage == {"inputTokens": 920, "outputTokens": 105}
    assert result.estimated_cost_usd == 0.00578
    calls = [record.fields for record in caplog.records]
    assert [call["stopReason"] for call in calls] == ["tool_use", "end_turn"]
    assert calls[0] | {"durationMs": 0} == {
        "operation": "Converse",
        "modelId": DEFAULT_MODEL_ID,
        "stopReason": "tool_use",
        "inputTokens": 400,
        "outputTokens": 60,
        "latencyMs": 900,
        "durationMs": 0,
        "estimatedCostUsd": 0.0028,
    }


@pytest.mark.parametrize(
    ("stop_reason", "outcome"),
    [("max_tokens", "truncated"), ("guardrail_intervened", "blocked"), ("content_filtered", "blocked")],
)
def test_stops_that_are_not_complete_answers_are_reported(client, stop_reason, outcome):
    with Stubber(client) as stubber:
        stubber.add_response("converse", reply(stop_reason, [{"text": "PLAT-104 is"}, GET_PLAT_104]), None)
        result = converse(client, QUESTION, SETTINGS)
    assert (result.outcome, result.model_calls) == (outcome, 1)


def test_malformed_output_raises_instead_of_answering(client):
    with Stubber(client) as stubber:
        stubber.add_response("converse", reply("malformed_tool_use", []), None)
        with pytest.raises(ConversationError) as error:
            converse(client, QUESTION, SETTINGS)
    assert error.value.stop_reason == "malformed_tool_use"


def test_a_model_that_keeps_asking_for_tools_is_stopped(client):
    with Stubber(client) as stubber:
        for _ in range(3):
            stubber.add_response("converse", reply("tool_use", [GET_PLAT_104]), None)
        with pytest.raises(ConversationError, match="No final answer after 3 model calls"):
            converse(client, QUESTION, SETTINGS, max_model_calls=3)


def test_a_service_error_reaches_the_caller(client):
    with Stubber(client) as stubber:
        stubber.add_client_error("converse", "ValidationException", "The provided model identifier is invalid.", 400)
        with pytest.raises(client.exceptions.ValidationException):
            converse(client, QUESTION, SETTINGS)


class FakeStreamingClient:
    """Stubber validates responses against the service model, and an event stream cannot be written as a stub
    response, so the streaming test uses this minimal stand-in: it records the request and yields the events."""

    def __init__(self, events):
        self.events, self.requests = events, []

    def converse_stream(self, **request):
        self.requests.append(request)
        return {"stream": iter(self.events)}


def test_stream_accumulates_text_and_reads_usage_from_metadata():
    events = [
        {"messageStart": {"role": "assistant"}},
        {"contentBlockDelta": {"contentBlockIndex": 0, "delta": {"text": "Release notes "}}},
        {"contentBlockDelta": {"contentBlockIndex": 0, "delta": {"text": "are ready."}}},
        {"messageStop": {"stopReason": "end_turn"}},
        {
            "metadata": {
                "usage": {"inputTokens": 1000, "outputTokens": 250, "totalTokens": 1250},
                "metrics": {"latencyMs": 2400},
            }
        },
    ]
    fragments = []
    client = FakeStreamingClient(events)
    result = stream_answer(client, "Summarize the release", SETTINGS, on_text=fragments.append)
    assert client.requests[0]["modelId"] == DEFAULT_MODEL_ID
    assert fragments == ["Release notes ", "are ready."]
    assert result == {
        "text": "Release notes are ready.",
        "stopReason": "end_turn",
        "usage": {"inputTokens": 1000, "outputTokens": 250},
        "estimatedCostUsd": 0.009,
    }


def test_client_has_a_read_timeout_and_standard_retries():
    client = create_client(BedrockSettings(region="eu-west-1", timeout_s=30, max_attempts=4))
    assert client.meta.region_name == "eu-west-1"
    assert client.meta.config.read_timeout == 30
    assert client.meta.config.connect_timeout == 5
    assert client.meta.config.retries == {"mode": "standard", "total_max_attempts": 4}


def test_settings_come_from_the_environment():
    settings = BedrockSettings.from_env(
        {"AWS_REGION": "us-east-1", "BEDROCK_MODEL_ID": "us.anthropic.claude-sonnet-5-5"}
    )
    assert (settings.model_id, settings.timeout_s, settings.max_attempts) == ("us.anthropic.claude-sonnet-5-5", 120, 3)
    with pytest.raises(ValueError, match="AWS_REGION"):
        BedrockSettings.from_env({})
