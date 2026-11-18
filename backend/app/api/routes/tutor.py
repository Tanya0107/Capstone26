"""Socratic tutoring endpoints (FR11, FR12).

POST /api/tutor/turn         one dialogue turn, non streaming
POST /api/tutor/turn/stream  the same turn revealed over SSE (NFR8)

Transport is student to FastAPI over SSE (D15). The stream reveals text
that has already passed the FR11 leak guard, it never forwards raw model
tokens, see socratic_agent.stream_turn.
"""
import json

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse

from app.agents.tutoring import socratic_agent
from app.api.deps import require_student
from app.core.firestore import get_exercise_with_solution
from app.core.schemas import TutorTurnRequest, TutorTurnResponse

router = APIRouter()


def _authorize(request: TutorTurnRequest, claims: dict) -> dict:
    """Students may only tutor as themselves (NFR4), and the exercise must
    exist. Resolved before streaming starts so a 404 is still possible."""
    if request.student_key != claims.get("uid"):
        raise HTTPException(status_code=403, detail="Tutoring is per student")
    exercise = get_exercise_with_solution(request.exercise_key)
    if exercise is None:
        raise HTTPException(status_code=404, detail="Exercise not found")
    return exercise


@router.post("/turn", response_model=TutorTurnResponse)
async def tutor_turn(
    request: TutorTurnRequest,
    claims: dict = Depends(require_student),
) -> TutorTurnResponse:
    """Non streaming variant (used by tests).

    Hard rule: the response NEVER contains the exercise's correct answer.
    """
    exercise = _authorize(request, claims)
    return await socratic_agent.run_turn(request, exercise=exercise)


@router.post("/turn/stream")
async def tutor_turn_stream(
    request: TutorTurnRequest,
    claims: dict = Depends(require_student),
) -> StreamingResponse:
    """SSE reveal of the same turn (NFR8)."""
    exercise = _authorize(request, claims)

    async def events():
        async for chunk in socratic_agent.stream_turn(request, exercise=exercise):
            if isinstance(chunk, str):
                payload = {"type": "token", "text": chunk}
            else:
                payload = {"type": "done", **chunk.model_dump(by_alias=True)}
            yield f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"

    return StreamingResponse(
        events(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
