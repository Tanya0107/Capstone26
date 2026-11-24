"""Question Generator, graduated Socratic hint ladder.

Levels:
  1. Metacognitive nudge      (What is the problem really asking?)
  2. Concept pointer          (Which property could relate these?)
  3. Strategy scaffold        (Try writing the relationship as an equation.)
  4. Worked sub step          (one concrete step, never the final answer)

Level selection is a function of hint history, repeated failure and
affective state. Pre-authored socraticHints are preferred when one exists
at the chosen level: a teacher reviewed it, and using it costs no model
call. Anything generated still passes the leak guard before it is sent.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Optional

from app.core.llm import get_chat_model
from app.core.schemas import AffectiveState

PROMPT_FILE = Path(__file__).resolve().parents[1] / "prompts" / "socratic_tutor.md"

MIN_HINT_LEVEL = 1
MAX_HINT_LEVEL = 4


PROGRESS_CATEGORIES = {"correct", "partial"}


def choose_hint_level(
    previous_level: int,
    affective_state: AffectiveState,
    escalate: bool,
    category: str = "misconception",
) -> int:
    """Where on the ladder the next hint sits.

    Climbing is for students who are stuck, not for students who are
    moving. A partial answer means the current rung is working, so the
    ladder holds rather than piling on scaffolding they did not need, and
    a correct one certainly does not call for more help. Repeated non
    correct attempts override that and climb anyway. Frustration takes two
    rungs to reach something concrete sooner. Boredom holds position:
    more scaffolding is the wrong answer to disengagement.
    """
    base = previous_level or 0

    def clamp(level: int) -> int:
        return max(MIN_HINT_LEVEL, min(MAX_HINT_LEVEL, level))

    step = 2 if affective_state is AffectiveState.frustrated else 1
    if escalate:
        # Stuck across several attempts, climb regardless of mood
        return clamp(base + step + 1)
    if base and category in PROGRESS_CATEGORIES:
        return clamp(base)
    if base and affective_state is AffectiveState.bored:
        return clamp(base)
    return clamp(base + step)


def authored_hint(exercise: dict, level: int) -> Optional[str]:
    for hint in exercise.get("socraticHints") or []:
        if hint.get("hintOrder") == level:
            text = (hint.get("hintText") or "").strip()
            if text:
                return text
    return None


async def next_hint(state: dict) -> dict:
    """Produce one hint at state hint_level. Returns hint_text, hint_level
    and source, where source is authored or generated."""
    exercise = state["exercise"]
    level = state["hint_level"]

    authored = authored_hint(exercise, level)
    if authored:
        return {"hint_text": authored, "hint_level": level, "source": "authored"}

    model = state.get("model") or get_chat_model("tutor")
    system = (
        PROMPT_FILE.read_text(encoding="utf-8")
        .replace("{{GRADE}}", str(exercise.get("gradeLevel", "")))
        .replace("{{SUBJECT}}", str(exercise.get("subject", "")))
        .replace("{{HINT_LEVEL}}", str(level))
        .replace("{{TONE}}", str(state.get("tone", "neutral")))
    )
    payload = json.dumps(
        {
            "exercise_prompt": exercise.get("prompt", ""),
            "scaffold_steps": exercise.get("scaffoldSteps", []),
            "student_message": state.get("student_message", ""),
            "evaluation_category": state.get("category", "off_task"),
            "known_misconceptions": state.get("misconceptions", []),
            "conversation_history": state.get("history", []),
        },
        ensure_ascii=False,
    )
    text = await model.complete(
        system,
        [{"role": "user", "content": payload}],
        timeout_s=state.get("timeout_s"),
    )
    return {"hint_text": text.strip(), "hint_level": level, "source": "generated"}
