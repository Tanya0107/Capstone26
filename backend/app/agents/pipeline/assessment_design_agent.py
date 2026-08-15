"""Stage 4 — Assessment Design Agent.

Compiles rubrics, diagnostic suites, and exit tickets aligned to the lessons.
Output state key: 'assessment' (AssessmentBundle).
"""
from app.agents.base import BaseAgent


class AssessmentDesignAgent(BaseAgent):
    name = "assessment_design"
    prompt_file = "assessment_design.md"

    async def run(self, state: dict) -> dict:
        raise NotImplementedError("Phase 3, Step 3.3")
