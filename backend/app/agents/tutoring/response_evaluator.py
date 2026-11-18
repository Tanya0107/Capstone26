"""Response Evaluator, classifies each student attempt.

Categories: correct / partial / misconception / off_task. Off task
detection feeds constructive redirection (Liu et al., 2025): passive or
off topic chat should trigger a redirect, not a hint.

This classifier sees the correct answer, because judging correctness
needs it. Its output is internal and only ever reaches the hint
generator as a category, never the student (FR11).
"""
from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Optional

from app.agents.base import parse_json_output
from app.core.llm import get_chat_model

logger = logging.getLogger(__name__)

PROMPT_FILE = Path(__file__).resolve().parents[1] / "prompts" / "response_evaluator.md"
VALID_CATEGORIES = {"correct", "partial", "misconception", "off_task"}


async def check(
    student_message: str,
    exercise: dict,
    *,
    model=None,
    timeout_s: Optional[float] = None,
) -> dict:
    """Classify one attempt. Never raises into the turn: an unusable
    classification degrades to off_task, which makes the tutor redirect
    gently rather than fail the student's message."""
    model = model or get_chat_model("tutor")
    system = (
        PROMPT_FILE.read_text(encoding="utf-8")
        .replace("{{SUBJECT}}", str(exercise.get("subject", "")))
        .replace("{{GRADE}}", str(exercise.get("gradeLevel", "")))
    )
    payload = json.dumps(
        {
            "exercise_prompt": exercise.get("prompt", ""),
            "correct_answer": exercise.get("correctAnswer", ""),
            "student_message": student_message,
        },
        ensure_ascii=False,
    )
    try:
        raw = await model.complete(
            system,
            [{"role": "user", "content": payload}],
            json_mode=True,
            timeout_s=timeout_s,
        )
        data = parse_json_output(raw)
        category = data.get("category")
        if category not in VALID_CATEGORIES:
            raise ValueError(f"unknown category {category!r}")
        return {
            "category": category,
            "misconception": data.get("misconception"),
            "knowledge_gap": data.get("knowledge_gap"),
        }
    except Exception:
        logger.exception("Response evaluation failed, treating the turn as off_task")
        return {"category": "off_task", "misconception": None, "knowledge_gap": None}
