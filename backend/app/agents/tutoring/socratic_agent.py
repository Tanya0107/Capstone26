"""Socratic Tutoring Agent — real-time event-driven loop (Fig 3, right branch). FR11.

run_turn() coordinates one dialogue turn:
  1. student_model.update(...)         — refresh knowledge-gap/misconception state
  2. adaptive_strategy.assess(...)     — infer affective state from telemetry (FR12)
  3. question_generator.next_hint(...) — pick hint level + generate a guiding question
  4. response_evaluator.check(...)     — classify the student's latest attempt

INVARIANT (FR11): output never contains the correct or model answer. Enforce
with prompt constraints plus a post generation guard. The guard is subject
aware (D8): quantitative subjects use exact and normalized numeric matching,
open ended subjects use high similarity matching against the model answer.
On a hit, regenerate at a more abstract hint level.
"""
from app.core.schemas import TutorTurnRequest, TutorTurnResponse


async def run_turn(request: TutorTurnRequest) -> TutorTurnResponse:
    raise NotImplementedError("Phase 3, Step 3.5")
