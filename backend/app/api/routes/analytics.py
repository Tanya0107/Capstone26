"""GET /api/analytics/* — aggregated telemetry for teacher dashboards (FR8, FR13)."""
from fastapi import APIRouter, Depends

from app.api.deps import require_teacher

router = APIRouter()


@router.get("/assignment/{assignment_key}")
async def assignment_analytics(assignment_key: str, claims: dict = Depends(require_teacher)) -> dict:
    """Aggregate ATT / TCV / HSR / NGS per student for one assignment.

    TODO Phase 5, Step 5.2: read telemetryEvents + studentProgress, compute via
    core.telemetry, return chart-ready JSON. Consider caching (60s) — dashboards
    poll; raw events can be large.
    """
    raise NotImplementedError
