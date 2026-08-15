"""ResilientChatModel retry and timeout tests (Step 3.1).

Wraps fakes, never the network (R7). FakeChatModel covers the happy path,
purpose built fakes cover failures and slowness.
"""
import asyncio

import pytest

from app.core.llm import (
    LLMCallError,
    LLMTimeoutError,
    ResilientChatModel,
    get_chat_model,
    l2_normalize,
)
from tests.conftest import FakeChatModel


class FlakyFake:
    """Fails a fixed number of times, then succeeds."""

    def __init__(self, failures: int, response: str = "ok"):
        self.failures = failures
        self.response = response
        self.attempts = 0

    async def complete(self, system, messages, *, json_mode=False):
        self.attempts += 1
        if self.attempts <= self.failures:
            raise RuntimeError(f"transient failure {self.attempts}")
        return self.response


class SlowFake:
    def __init__(self, delay_s: float):
        self.delay_s = delay_s

    async def complete(self, system, messages, *, json_mode=False):
        await asyncio.sleep(self.delay_s)
        return "too late"


async def test_happy_path_wraps_fake():
    model = ResilientChatModel(FakeChatModel(['{"answer": 4}']))
    result = await model.complete("system", [{"role": "user", "content": "2+2"}])
    assert result == '{"answer": 4}'


async def test_retries_then_succeeds():
    fake = FlakyFake(failures=2)
    model = ResilientChatModel(fake, max_retries=2, backoff_base_s=0.001)
    result = await model.complete("s", [])
    assert result == "ok"
    assert fake.attempts == 3


async def test_retries_exhausted_raises_call_error():
    fake = FlakyFake(failures=10)
    model = ResilientChatModel(fake, max_retries=2, backoff_base_s=0.001)
    with pytest.raises(LLMCallError):
        await model.complete("s", [])
    assert fake.attempts == 3


async def test_timeout_respects_remaining_budget():
    model = ResilientChatModel(SlowFake(delay_s=1.0))
    with pytest.raises(LLMTimeoutError):
        await model.complete("s", [], timeout_s=0.05)


async def test_timeout_covers_backoff_between_retries():
    fake = FlakyFake(failures=10)
    model = ResilientChatModel(fake, max_retries=2, backoff_base_s=5.0)
    with pytest.raises(LLMTimeoutError):
        await model.complete("s", [], timeout_s=0.05)


async def test_stream_passthrough():
    model = ResilientChatModel(FakeChatModel(["hello world"]))
    tokens = [token async for token in model.stream("s", [])]
    assert "".join(tokens).strip() == "hello world"


def test_get_chat_model_roles():
    generator = get_chat_model("generator")
    critic = get_chat_model("critic")
    assert type(generator.inner.chat).__name__ == "ChatAnthropic"
    assert type(critic.inner.chat).__name__ == "ChatOpenAI"
    with pytest.raises(ValueError):
        get_chat_model("unknown-role")


def test_l2_normalize():
    [unit] = l2_normalize([[3.0, 4.0]])
    assert unit == pytest.approx([0.6, 0.8])
    [zero] = l2_normalize([[0.0, 0.0]])
    assert zero == [0.0, 0.0]
