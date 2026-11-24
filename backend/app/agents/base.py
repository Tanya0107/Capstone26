"""Shared agent base class.

Each pipeline stage is a small, single-responsibility agent: it loads its
prompt template from agents/prompts/, calls the LLM in JSON mode, validates
output against a Pydantic schema, and returns typed data. On validation
failure the call retries once with the validation error appended to the
prompt, then raises (BUILD_GUIDE Step 3.3 pattern).
"""
from __future__ import annotations

import json
import logging
import re
from abc import ABC, abstractmethod
from pathlib import Path
from typing import Any, Callable, Optional, TypeVar

from app.core.llm import get_chat_model

PROMPTS_DIR = Path(__file__).parent / "prompts"

logger = logging.getLogger(__name__)

T = TypeVar("T")

FENCE_RE = re.compile(r"^```[a-zA-Z]*\n?|\n?```$")


class AgentOutputError(Exception):
    """The model output failed schema validation twice."""


def strip_code_fences(raw: str) -> str:
    return FENCE_RE.sub("", raw.strip()).strip()


def parse_json_output(raw: str) -> Any:
    """Parse model JSON, tolerating code fences and stray prose around one
    top level object, so a chatty preamble does not cost a full retry."""
    text = strip_code_fences(raw)
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        start, end = text.find("{"), text.rfind("}")
        if start == -1 or end <= start:
            raise
        return json.loads(text[start : end + 1])


class BaseAgent(ABC):
    name: str = "base"
    prompt_file: str = ""          # e.g. "intake.md"
    model_role: str = "generator"  # resolved by core.llm.get_chat_model

    def __init__(self, model=None):
        # Injectable for tests, wrap FakeChatModel in ResilientChatModel (R7)
        self._model = model

    @property
    def model(self):
        if self._model is None:
            self._model = get_chat_model(self.model_role)
        return self._model

    def load_prompt(self, **replacements: str) -> str:
        prompt = (PROMPTS_DIR / self.prompt_file).read_text(encoding="utf-8")
        for key, value in replacements.items():
            prompt = prompt.replace("{{" + key + "}}", value)
        return prompt

    @staticmethod
    def remaining_budget(state: dict) -> Optional[float]:
        if "started_at" not in state:
            return None
        from app.agents.orchestrator import remaining_budget

        return remaining_budget(state)

    async def call_json(
        self,
        system: str,
        user_content: str,
        state: dict,
        validate: Callable[[Any], T],
    ) -> T:
        """One JSON mode model call with a single validation retry.

        validate receives the parsed JSON and returns typed data, raising
        on schema violations (typically Model.model_validate).
        """
        raw = await self.model.complete(
            system,
            [{"role": "user", "content": user_content}],
            json_mode=True,
            timeout_s=self.remaining_budget(state),
        )
        try:
            return validate(parse_json_output(raw))
        except Exception as first_error:
            logger.warning(
                "%s output failed validation, retrying once: %s", self.name, first_error
            )
            retry_content = (
                f"{user_content}\n\n"
                "Your previous output failed validation with this error:\n"
                f"{first_error}\n"
                "Return corrected strict JSON only, no prose."
            )
            raw = await self.model.complete(
                system,
                [{"role": "user", "content": retry_content}],
                json_mode=True,
                timeout_s=self.remaining_budget(state),
            )
            try:
                return validate(parse_json_output(raw))
            except Exception as second_error:
                raise AgentOutputError(
                    f"{self.name} output failed validation twice: {second_error}"
                ) from second_error

    @abstractmethod
    async def run(self, state: dict) -> dict:
        """Consume the shared pipeline state, return the updated state.

        State keys accumulate across stages:
          request -> standards -> sequence -> lessons -> assessment
          -> critic_report -> package
        """
        ...
