"""Stage 3. Lesson Design Agent.

Drafts lesson objectives, introductory hooks, interactive exercises with
scaffold steps and graduated Socratic hints (consumed later by the tutor).
Output state key: lessons (list[LessonUnit]).

On critic rejection, this stage re-runs WITH state critic_report issues
included in the prompt (fix exactly these problems, change nothing else).
"""
import json

from pydantic import BaseModel, Field

from app.agents.base import BaseAgent
from app.core.schemas import LessonUnit


class LessonsOutput(BaseModel):
    lessons: list[LessonUnit] = Field(..., min_length=1)


def _validate_lessons(data: dict) -> LessonsOutput:
    output = LessonsOutput.model_validate(data)
    orders = [ex.order for lesson in output.lessons for ex in lesson.exercises]
    if len(orders) != len(set(orders)):
        raise ValueError(
            "Exercise order values must be unique across ALL lessons, "
            f"got {sorted(orders)}"
        )
    if not orders:
        raise ValueError("At least one exercise is required")
    return output


class LessonDesignAgent(BaseAgent):
    name = "lesson_design"
    prompt_file = "lesson_design.md"

    async def run(self, state: dict) -> dict:
        request = state["request"]
        payload: dict = {
            "goals": request.goals,
            "topics": request.topics,
            "grade_level": request.grade_level,
            "difficulty_level": request.difficulty_level,
            "standards": state.get("standards", []),
            "weekly_sequence": state.get("sequence", []),
            "rag_context": state.get("rag_context", []),
        }
        report = state.get("critic_report")
        if report is not None and not report.approved:
            payload["previous_lessons"] = [
                lesson.model_dump(by_alias=True) for lesson in state.get("lessons", [])
            ]
            payload["critic_issues"] = [
                issue.model_dump(by_alias=True) for issue in report.issues
            ]
        user_content = json.dumps(payload, ensure_ascii=False)
        output = await self.call_json(
            self.load_prompt(), user_content, state, _validate_lessons
        )
        state["lessons"] = output.lessons
        return state
