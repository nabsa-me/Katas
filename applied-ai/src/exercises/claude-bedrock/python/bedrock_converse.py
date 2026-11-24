"""Claude on Amazon Bedrock with boto3: the Converse tool loop, ConverseStream, timeouts, retries and usage logs.

The Python twin of the TypeScript exercise: same tool, same prices file, same handling of every stop reason.
"""

import json
import logging
import os
import time
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import boto3
from botocore.config import Config

from issue_tool import GET_ISSUE_SPEC, load_issues, run_tool

DEFAULT_MODEL_ID = "global.anthropic.claude-opus-5-5"
EXERCISE_DIR = Path(__file__).resolve().parent.parent
PRICING_FILE = EXERCISE_DIR / "pricing.json"
SYSTEM_PROMPT = (
    "You answer questions about the Jira issues of the PLAT project. Use the get_issue tool to read an issue before "
    "describing it; never invent status, assignees or dates. If an issue does not exist, say so."
)

logger = logging.getLogger("claude_bedrock")


@dataclass(frozen=True)
class BedrockSettings:
    region: str
    model_id: str = DEFAULT_MODEL_ID
    timeout_s: float = 120
    max_attempts: int = 3
    max_tokens: int = 16_000

    @classmethod
    def from_env(cls, env: dict[str, str] | None = None) -> "BedrockSettings":
        env = dict(os.environ) if env is None else env
        if not env.get("AWS_REGION"):
            raise ValueError("AWS_REGION is required, for example us-east-1")
        return cls(
            region=env["AWS_REGION"],
            model_id=env.get("BEDROCK_MODEL_ID") or DEFAULT_MODEL_ID,
            timeout_s=int(env.get("BEDROCK_TIMEOUT_MS", "120000")) / 1000,
            max_attempts=int(env.get("BEDROCK_MAX_ATTEMPTS", "3")),
            max_tokens=int(env.get("BEDROCK_MAX_TOKENS", "16000")),
        )


def create_client(settings: BedrockSettings) -> Any:
    """A bedrock-runtime client with explicit timeouts and the standard retry mode (throttling, 5xx, timeouts)."""
    config = Config(
        connect_timeout=5,
        read_timeout=settings.timeout_s,  # longest silence on the socket; a timed-out attempt is retried
        retries={"mode": "standard", "total_max_attempts": settings.max_attempts},
    )
    return boto3.client("bedrock-runtime", region_name=settings.region, config=config)


def load_pricing() -> dict[str, Any]:
    return json.loads(PRICING_FILE.read_text(encoding="utf-8"))


def estimate_cost_usd(model_id: str, usage: dict[str, int], pricing: dict[str, Any]) -> float | None:
    """Estimated cost of input and output tokens, or None when the model has no known price."""
    price = pricing["models"].get(model_id)
    if price is None:
        return None
    cost = usage["inputTokens"] * price["inputPerMillion"] + usage["outputTokens"] * price["outputPerMillion"]
    return round(cost / 1_000_000, 6)


def log_model_call(operation: str, model_id: str, stop_reason: str | None, usage: dict[str, int], **extra: Any) -> None:
    fields = {"operation": operation, "modelId": model_id, "stopReason": stop_reason, **usage, **extra}
    logger.info("model call %s", json.dumps(fields), extra={"fields": fields})


FINAL_OUTCOMES = {
    "end_turn": "answered",
    "stop_sequence": "answered",
    "max_tokens": "truncated",
    "guardrail_intervened": "blocked",
    "content_filtered": "blocked",
}


class ConversationError(Exception):
    def __init__(self, message: str, stop_reason: str | None = None) -> None:
        super().__init__(message)
        self.stop_reason = stop_reason


@dataclass(frozen=True)
class ConversationResult:
    outcome: str  # "answered", "truncated" or "blocked"
    text: str
    stop_reason: str
    model_calls: int
    usage: dict[str, int]
    estimated_cost_usd: float | None


def converse(client: Any, question: str, settings: BedrockSettings, max_model_calls: int = 5) -> ConversationResult:
    """Asks one question and runs the tool-use loop until a final answer, handling every stop reason."""
    issues, pricing = load_issues(), load_pricing()
    messages: list[dict[str, Any]] = [{"role": "user", "content": [{"text": question}]}]
    usage = {"inputTokens": 0, "outputTokens": 0}

    for call in range(1, max_model_calls + 1):
        started = time.monotonic()
        response = client.converse(
            modelId=settings.model_id,
            system=[{"text": SYSTEM_PROMPT}],
            messages=list(messages),
            inferenceConfig={"maxTokens": settings.max_tokens},
            toolConfig={"tools": [GET_ISSUE_SPEC]},
        )
        call_usage = {key: response["usage"][key] for key in ("inputTokens", "outputTokens")}
        usage = {key: usage[key] + call_usage[key] for key in usage}
        stop_reason, message = response["stopReason"], response["output"]["message"]
        log_model_call(
            "Converse",
            settings.model_id,
            stop_reason,
            call_usage,
            latencyMs=response["metrics"]["latencyMs"],
            durationMs=round((time.monotonic() - started) * 1000),
            estimatedCostUsd=estimate_cost_usd(settings.model_id, call_usage, pricing),
        )
        messages.append(message)  # exactly as received, reasoning blocks included

        if stop_reason in FINAL_OUTCOMES:  # max_tokens included: a truncated turn never runs its tool calls
            text = "".join(block["text"] for block in message["content"] if "text" in block)
            cost = estimate_cost_usd(settings.model_id, usage, pricing)
            return ConversationResult(FINAL_OUTCOMES[stop_reason], text, stop_reason, call, usage, cost)
        if stop_reason != "tool_use":  # malformed_*, model_context_window_exceeded, or a new value
            raise ConversationError(f"The model stopped with {stop_reason}; this is not an answer", stop_reason)
        tool_uses = [block["toolUse"] for block in message["content"] if "toolUse" in block]
        results = [{"toolResult": run_tool(tool_use, issues)} for tool_use in tool_uses]
        messages.append({"role": "user", "content": results})  # every result in one user message
    raise ConversationError(f"No final answer after {max_model_calls} model calls")


def stream_answer(
    client: Any, question: str, settings: BedrockSettings, on_text: Callable[[str], None] | None = None
) -> dict[str, Any]:
    """Streams one answer: text from contentBlockDelta, stop reason from messageStop, usage from metadata.

    An error event in the stream (throttling, model stream error) is raised by boto3 while iterating, after the
    fragments already passed to on_text; the caller decides whether to retry the whole answer.
    """
    started = time.monotonic()
    response = client.converse_stream(
        modelId=settings.model_id,
        system=[{"text": SYSTEM_PROMPT}],
        messages=[{"role": "user", "content": [{"text": question}]}],
        inferenceConfig={"maxTokens": settings.max_tokens},
    )
    text, stop_reason, usage, latency_ms = "", None, {"inputTokens": 0, "outputTokens": 0}, None
    for event in response["stream"]:
        if "contentBlockDelta" in event and "text" in event["contentBlockDelta"]["delta"]:
            fragment = event["contentBlockDelta"]["delta"]["text"]
            text += fragment
            if on_text:
                on_text(fragment)
        elif "messageStop" in event:
            stop_reason = event["messageStop"]["stopReason"]
        elif "metadata" in event:
            usage = {key: event["metadata"]["usage"][key] for key in ("inputTokens", "outputTokens")}
            latency_ms = event["metadata"]["metrics"]["latencyMs"]
    cost = estimate_cost_usd(settings.model_id, usage, load_pricing())
    duration_ms = round((time.monotonic() - started) * 1000)
    log_model_call(
        "ConverseStream", settings.model_id, stop_reason, usage, latencyMs=latency_ms, durationMs=duration_ms
    )
    return {"text": text, "stopReason": stop_reason, "usage": usage, "estimatedCostUsd": cost}
