"""POST /api/feedback/edits — FR6 Adaptive Learning ingestion.

Called by the Review Dashboard whenever a teacher saves modifications.
"""
from fastapi import APIRouter, Depends

from app.api.deps import require_teacher
from app.core.schemas import TeacherEditRecord

router = APIRouter()


@router.post("/edits")
async def ingest_edits(
    record: TeacherEditRecord,
    claims: dict = Depends(require_teacher),
) -> dict:
    """TODO Phase 3, Step 3.4: distance = await memory_bank.ingest_teacher_edit(record)
    Return {"semantic_distance": distance, "stored": bool}."""
    raise NotImplementedError
