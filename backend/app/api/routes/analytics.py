"""GET /api/analytics/* — aggregated telemetry for teacher dashboards (FR8, FR13)."""
from fastapi import APIRouter, Depends

from app.api.deps import require_teacher
from app.core.schemas import AssignmentAnalytics

router = APIRouter()


@router.get("/assignment/{assignment_key}", response_model=AssignmentAnalytics)
async def assignment_analytics(
    assignment_key: str, claims: dict = Depends(require_teacher)
) -> AssignmentAnalytics:
    """Aggregate ATT / TCV / HSR / NGS per student for one assignment.

    TODO Phase 5, Step 5.2: read telemetryEvents + studentProgress, compute via
    core.telemetry, return chart-ready JSON. Consider caching (60s) — dashboards
    poll; raw events can be large.
    """
    raise NotImplementedError
