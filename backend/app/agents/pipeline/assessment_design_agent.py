"""Stage 4. Assessment Design Agent.

Compiles rubrics, diagnostic suites, and exit tickets aligned to the
lessons. Output state key: assessment (AssessmentBundle).
"""
import json

from app.agents.base import BaseAgent
from app.core.schemas import AssessmentBundle


class AssessmentDesignAgent(BaseAgent):
    name = "assessment_design"
    prompt_file = "assessment_design.md"

    async def run(self, state: dict) -> dict:
        request = state["request"]
        lessons = state.get("lessons", [])
        user_content = json.dumps(
            {
                "goals": request.goals,
                "grade_level": request.grade_level,
                "difficulty_level": request.difficulty_level,
                "lessons": [
                    {
                        "title": lesson.title,
                        "objectives": lesson.objectives,
                        "exercise_prompts": [ex.prompt for ex in lesson.exercises],
                    }
                    for lesson in lessons
                ],
            },
            ensure_ascii=False,
        )
        state["assessment"] = await self.call_json(
            self.load_prompt(), user_content, state, AssessmentBundle.model_validate
        )
        return state
