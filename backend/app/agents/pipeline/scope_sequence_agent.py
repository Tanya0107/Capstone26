"""Stage 2 — Scope & Sequence Agent.

Structures topics into a logical weekly progression with flex-time.
Output state key: 'sequence' (ordered weekly plan).
"""
from app.agents.base import BaseAgent


class ScopeSequenceAgent(BaseAgent):
    name = "scope_sequence"
    prompt_file = "scope_sequence.md"

    async def run(self, state: dict) -> dict:
        raise NotImplementedError("Phase 3, Step 3.3")
