"""Stage 6 — Curriculum Package Agent.

Bundles all approved artifacts into the final structured JSON teacher guide
(CurriculumPackage). Mostly deterministic assembly + a light LLM pass for the
title/summary; must be schema-valid on the first try.
"""
from app.agents.base import BaseAgent


class PackageAgent(BaseAgent):
    name = "package"
    prompt_file = "package.md"

    async def run(self, state: dict) -> dict:
        raise NotImplementedError("Phase 3, Step 3.3")
