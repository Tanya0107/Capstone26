"""Stage 2. Scope and Sequence Agent.

Structures topics into a logical weekly progression with flex time.
Output state key: sequence (ordered weekly plan as display strings).
"""
import json

from pydantic import BaseModel, Field

from app.agents.base import BaseAgent


class Week(BaseModel):
    week: int = Field(..., ge=1)
    focus: str
    topics: list[str] = Field(default_factory=list)
    flex: bool = False


class SequenceOutput(BaseModel):
    weeks: list[Week] = Field(..., min_length=1)


class ScopeSequenceAgent(BaseAgent):
    name = "scope_sequence"
    prompt_file = "scope_sequence.md"

    async def run(self, state: dict) -> dict:
        request = state["request"]
        user_content = json.dumps(
            {
                "goals": request.goals,
                "topics": request.topics,
                "grade_level": request.grade_level,
                "difficulty_level": request.difficulty_level,
                "standards": state.get("standards", []),
                "development_targets": state.get("development_targets", []),
            },
            ensure_ascii=False,
        )
        output = await self.call_json(
            self.load_prompt(), user_content, state, SequenceOutput.model_validate
        )
        state["sequence"] = [
            f"שבוע {week.week}: {week.focus}" + (" (זמן גמיש)" if week.flex else "")
            for week in sorted(output.weeks, key=lambda w: w.week)
        ]
        state["weeks"] = [week.model_dump() for week in output.weeks]
        return state
