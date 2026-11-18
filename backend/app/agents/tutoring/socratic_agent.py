"""Socratic Tutoring Agent, real time loop (Fig 3, right branch). FR11.

run_turn coordinates one dialogue turn:
  1. response_evaluator.check      classify the student's latest attempt
  2. student_model.update          refresh knowledge gap and misconception state
  3. adaptive_strategy.assess      infer affective state from telemetry (FR12)
  4. question_generator.next_hint  pick a hint level and produce the question

INVARIANT (FR11, R6): output never contains the correct or model answer.
Enforced by prompt constraints AND a post generation guard. The guard is
subject aware (D8). On a hit the hint is regenerated one rung more
abstract, at most MAX_LEAK_REGENERATIONS times, then the turn falls back
to a fixed metacognitive prompt that cannot leak.

Streaming note: because the guard is a POST generation check, nothing
model written may be streamed to a student before it has passed. The
stream therefore reveals already validated text progressively rather than
piping raw model tokens. It costs the time to first token that NFR8 would
have bought, and it is the only way to keep the FR11 invariant absolute.
"""
from __future__ import annotations

import logging
import time
from typing import AsyncIterator, Optional

from app.agents.tutoring import adaptive_strategy, question_generator, response_evaluator
from app.agents.tutoring.answer_leak import SAFEST_FALLBACK_HINT, leaks_answer
from app.agents.tutoring.question_generator import MIN_HINT_LEVEL, choose_hint_level
from app.agents.tutoring.session_store import default_store
from app.config import get_settings, subject_type
from app.core.firestore import get_exercise_with_solution
from app.core.schemas import TutorTurnRequest, TutorTurnResponse

logger = logging.getLogger(__name__)

MAX_LEAK_REGENERATIONS = 2
# Chunk size when revealing validated text over SSE
STREAM_CHUNK_CHARS = 24


class TutorExerciseNotFound(Exception):
    """The requested exercise does not exist, the route turns this into 404."""


def _leaks(hint: str, answer: str, subject: str) -> bool:
    """Leak check that fails safe on an unclassified subject by applying
    both detectors rather than skipping the check."""
    try:
        return leaks_answer(hint, answer, subject_type(subject))
    except ValueError:
        logger.warning("Subject %r is unclassified, applying both leak checks", subject)
        return leaks_answer(hint, answer, "quantitative") or leaks_answer(
            hint, answer, "open_ended"
        )


async def run_turn(
    request: TutorTurnRequest,
    *,
    store=None,
    model=None,
    exercise: Optional[dict] = None,
) -> TutorTurnResponse:
    settings = get_settings()
    deadline = time.monotonic() + settings.tutor_turn_timeout_seconds

    def remaining() -> float:
        return max(0.1, deadline - time.monotonic())

    store = store or default_store
    if exercise is None:
        exercise = get_exercise_with_solution(request.exercise_key)
    if exercise is None:
        raise TutorExerciseNotFound(request.exercise_key)

    answer = exercise.get("correctAnswer", "")
    subject = exercise.get("subject", "")

    evaluation = await response_evaluator.check(
        request.student_message, exercise, model=model, timeout_s=remaining()
    )
    student = store.get_or_create(request.student_key, request.assignment_key)
    student.update(request.student_message, evaluation, request.exercise_key)

    affective = adaptive_strategy.assess(request.telemetry_snapshot)
    tone = adaptive_strategy.tone_for(affective)
    level = choose_hint_level(
        student.last_hint_level.get(request.exercise_key, 0),
        affective,
        student.should_escalate(request.exercise_key),
        evaluation["category"],
    )

    # A student who has just stated the correct answer themselves may be
    # told they are right. Echoing back what they already wrote reveals
    # nothing, while refusing to confirm leaves the tutor unable to close
    # a solved exercise and pushes it back down the ladder. Both halves
    # are required: the evaluator must agree it is correct AND the value
    # must already be in the student's own message.
    confirmation_allowed = evaluation["category"] == "correct" and _leaks(
        request.student_message, answer, subject
    )
    if confirmation_allowed:
        logger.info(
            "Exercise %s: student stated the correct answer, confirmation allowed",
            request.exercise_key,
        )

    hint_text: Optional[str] = None
    level_used = level
    for attempt in range(MAX_LEAK_REGENERATIONS + 1):
        candidate = await question_generator.next_hint(
            {
                "exercise": exercise,
                "hint_level": level,
                "tone": tone,
                "student_message": request.student_message,
                "category": evaluation["category"],
                "misconceptions": student.misconceptions,
                "history": [m.model_dump() for m in request.conversation_history][-6:],
                "model": model,
                "timeout_s": remaining(),
            }
        )
        if confirmation_allowed or not _leaks(candidate["hint_text"], answer, subject):
            hint_text = candidate["hint_text"]
            level_used = candidate["hint_level"]
            break
        logger.warning(
            "Answer leak blocked on exercise %s at level %s (attempt %d), "
            "regenerating more abstract",
            request.exercise_key,
            level,
            attempt + 1,
        )
        level = max(MIN_HINT_LEVEL, level - 1)

    if hint_text is None:
        # Every attempt leaked. Never send the student a leaking hint.
        logger.error(
            "All %d hint attempts leaked on exercise %s, using the safe fallback",
            MAX_LEAK_REGENERATIONS + 1,
            request.exercise_key,
        )
        hint_text = SAFEST_FALLBACK_HINT
        level_used = MIN_HINT_LEVEL

    student.record_hint(request.exercise_key, level_used)
    return TutorTurnResponse(
        hint_text=hint_text,
        hint_level=level_used,
        affective_state=affective,
        tone=tone,
    )


async def stream_turn(
    request: TutorTurnRequest, **kwargs
) -> AsyncIterator[TutorTurnResponse | str]:
    """Yield the validated hint progressively, then the full response.

    The hint is generated and leak checked in full first, so what streams
    is always text that has already passed FR11. Raw model tokens are
    never forwarded to a student.
    """
    response = await run_turn(request, **kwargs)
    for start in range(0, len(response.hint_text), STREAM_CHUNK_CHARS):
        yield response.hint_text[start : start + STREAM_CHUNK_CHARS]
    yield response
