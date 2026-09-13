"""Stage 6. Curriculum Package Agent.

Bundles all approved artifacts into the final structured JSON teacher
guide (CurriculumPackage). Deterministic assembly plus one light LLM pass
for the title and summary. Must be schema valid on the first try.
"""
import json

from pydantic import BaseModel

from app.agents.base import BaseAgent
from app.core.schemas import CurriculumPackage, QualityScores


class TitleSummary(BaseModel):
    title: str
    summary: str


class PackageAgent(BaseAgent):
    name = "package"
    prompt_file = "package.md"

    async def run(self, state: dict) -> dict:
        request = state["request"]
        lessons = state["lessons"]
        user_content = json.dumps(
            {
                "goals": request.goals,
                "grade_level": request.grade_level,
                "weekly_sequence": state.get("sequence", []),
                "lesson_titles": [lesson.title for lesson in lessons],
                "standards": [s.get("id") for s in state.get("standards", [])],
            },
            ensure_ascii=False,
        )
        meta = await self.call_json(
            self.load_prompt(), user_content, state, TitleSummary.model_validate
        )
        state["package"] = CurriculumPackage(
            title=meta.title,
            summary=meta.summary,
            subject=request.subject,
            grade_level=request.grade_level,
            difficulty_level=request.difficulty_level,
            weekly_sequence=state.get("sequence", []),
            lessons=lessons,
            assessment=state["assessment"],
            critic_report=state["critic_report"],
            quality_scores=QualityScores(),
        )
        return state
