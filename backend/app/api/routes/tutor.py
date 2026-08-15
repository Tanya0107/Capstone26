"""Socratic tutoring endpoints (FR11, FR12).

POST /api/tutor/turn — one dialogue turn; supports token streaming (SSE) so the
frontend can show progressive output (NFR8, TTFT mitigation, book §Challenges #2).

OPEN QUESTION Q6: the book mentions both a FastAPI path and a "real-time
Firebase listener" for the bot. Default skeleton: student -> FastAPI (SSE
stream) -> response also mirrored to Firestore for persistence/analytics.
"""
from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse

from app.api.deps import require_student
from app.core.schemas import TutorTurnRequest, TutorTurnResponse

router = APIRouter()


@router.post("/turn", response_model=TutorTurnResponse)
async def tutor_turn(
    request: TutorTurnRequest,
    claims: dict = Depends(require_student),
) -> TutorTurnResponse:
    """Non-streaming variant (used by tests).

    TODO Phase 3, Step 3.5: delegate to tutoring.socratic_agent.run_turn().
    Hard rule: the response NEVER contains the exercise's correct answer.
    """
    raise NotImplementedError


@router.post("/turn/stream")
async def tutor_turn_stream(
    request: TutorTurnRequest,
    claims: dict = Depends(require_student),
) -> StreamingResponse:
    """SSE token stream of the same turn (NFR8)."""
    raise NotImplementedError
