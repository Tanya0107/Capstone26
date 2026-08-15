"""Stage 3 — Lesson Design Agent.

Drafts lesson objectives, introductory hooks, interactive exercises with
scaffold steps and graduated Socratic hints (consumed later by the tutor).
Output state key: 'lessons' (list[LessonUnit]).

On critic rejection, this stage re-runs WITH state['critic_report'].issues
included in the prompt ("fix exactly these problems, change nothing else").
"""
from app.agents.base import BaseAgent


class LessonDesignAgent(BaseAgent):
    name = "lesson_design"
    prompt_file = "lesson_design.md"

    async def run(self, state: dict) -> dict:
        raise NotImplementedError("Phase 3, Step 3.3")
