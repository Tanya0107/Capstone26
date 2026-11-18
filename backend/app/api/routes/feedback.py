"""POST /api/feedback/edits, FR6 Adaptive Learning ingestion.

Called by the Review Dashboard whenever a teacher saves modifications.
"""
from fastapi import APIRouter, Depends, HTTPException

from app.api.deps import require_teacher
from app.core import memory_bank
from app.core.schemas import FeedbackIngestResponse, TeacherEditRecord

router = APIRouter()


@router.post("/edits", response_model=FeedbackIngestResponse)
async def ingest_edits(
    record: TeacherEditRecord,
    claims: dict = Depends(require_teacher),
) -> FeedbackIngestResponse:
    """Score the edit and store it when it is substantive (FR6).

    A teacher may only file edits under their own key, otherwise one
    teacher's style preferences would be attributed to another.
    """
    if record.teacher_key != claims.get("uid"):
        raise HTTPException(status_code=403, detail="Edits must use your own teacherKey")
    result = await memory_bank.ingest_teacher_edit(record)
    return FeedbackIngestResponse(
        semantic_distance=result.semantic_distance, stored=result.stored
    )
