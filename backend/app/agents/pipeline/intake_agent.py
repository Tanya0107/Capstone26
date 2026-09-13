"""Stage 1. Intake Agent.

Anchors the teacher goals to the Israeli MOE curriculum for the requested
subject (D4, D8). Input is the GenerationRequest plus RAG context. Output
state key is standards, a list of anchored standard IDs with rationale.

Corpus loading: agents/standards/il_moe/{subject}.json, filtered to the
requested grade before prompting. The agent may only cite IDs present in
the filtered slice. A missing subject file is a 422 at the route layer,
never a silent fallback.
"""
import json

from pydantic import BaseModel, Field

from app.agents.base import BaseAgent
from app.agents.standards.loader import load_standards


class AnchoredStandard(BaseModel):
    id: str
    text_he: str = ""
    rationale_he: str = ""


class IntakeOutput(BaseModel):
    standards: list[AnchoredStandard] = Field(..., min_length=1)
    development_targets_he: list[str] = Field(default_factory=list)


class IntakeAgent(BaseAgent):
    name = "intake"
    prompt_file = "intake.md"

    async def run(self, state: dict) -> dict:
        request = state["request"]
        standards_slice = load_standards(request.subject, request.grade_level)
        valid_ids = {entry["id"] for entry in standards_slice} | {"UNMAPPED"}

        def validate(data: dict) -> IntakeOutput:
            output = IntakeOutput.model_validate(data)
            cited = {standard.id for standard in output.standards}
            unknown = cited - valid_ids
            if unknown:
                raise ValueError(
                    f"Cited standard IDs not in the provided slice: {sorted(unknown)}"
                )
            return output

        user_content = json.dumps(
            {
                "goals": request.goals,
                "topics": request.topics,
                "grade_level": request.grade_level,
                "difficulty_level": request.difficulty_level,
                "standards_hint": request.standards_hint,
                "rag_context": state.get("rag_context", []),
                "standards_slice": standards_slice,
            },
            ensure_ascii=False,
        )
        output = await self.call_json(
            self.load_prompt(SUBJECT=request.subject), user_content, state, validate
        )
        state["standards"] = [standard.model_dump() for standard in output.standards]
        state["development_targets"] = output.development_targets_he
        return state
