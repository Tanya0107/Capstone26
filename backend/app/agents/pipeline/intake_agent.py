"""Stage 1. Intake Agent.

Anchors the teacher goals to the Israeli MOE curriculum for the requested
subject (D4, D8). Input is the GenerationRequest plus RAG context. Output
state key is standards, a list of anchored standard IDs with rationale.

Corpus loading: agents/standards/il_moe/{subject}.json, filtered to the
requested grade before prompting. The agent may only cite IDs present in the
filtered slice. A missing subject file is a 422 at the route layer, never a
silent fallback.
"""
from app.agents.base import BaseAgent


class IntakeAgent(BaseAgent):
    name = "intake"
    prompt_file = "intake.md"

    async def run(self, state: dict) -> dict:
        raise NotImplementedError("Phase 3, Step 3.3")
