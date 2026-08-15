"""Shared agent base class.

Each pipeline stage is a small, single-responsibility agent: it loads its
prompt template from agents/prompts/, calls the LLM in JSON mode, validates
output against a Pydantic schema, and returns typed data. Fail fast on schema
violations — the orchestrator decides whether to retry.
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from pathlib import Path
from typing import Any

PROMPTS_DIR = Path(__file__).parent / "prompts"


class BaseAgent(ABC):
    name: str = "base"
    prompt_file: str = ""          # e.g. "intake.md"
    model_role: str = "generator"  # resolved by core.llm.get_chat_model

    def load_prompt(self) -> str:
        return (PROMPTS_DIR / self.prompt_file).read_text(encoding="utf-8")

    @abstractmethod
    async def run(self, state: dict) -> dict:
        """Consume the shared pipeline state, return the updated state.

        State keys accumulate across stages:
          request -> standards -> sequence -> lessons -> assessment
          -> critic_report -> package
        """
        ...
