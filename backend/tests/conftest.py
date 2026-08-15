"""Shared fixtures.

Principles:
  * Unit tests NEVER hit real LLMs — use FakeChatModel with canned outputs.
  * Firestore tests run against the Emulator Suite (skip if not running).
"""
import pytest

from app.core.schemas import GenerationRequest


@pytest.fixture
def sample_request() -> GenerationRequest:
    return GenerationRequest(
        teacher_key="t_test",
        school_key="s_test",
        goals="Deepen fraction sense through real-world cooking problems",
        topics=["fractions", "ratios"],
        grade_level="5",
        difficulty_level=3,
    )


class FakeChatModel:
    """Deterministic stand-in for core.llm.ChatModel; returns queued responses."""

    def __init__(self, responses: list[str]):
        self._responses = list(responses)

    async def complete(self, system: str, messages: list, *, json_mode: bool = False) -> str:
        return self._responses.pop(0)

    async def stream(self, system: str, messages: list):
        for token in self._responses.pop(0).split():
            yield token + " "
