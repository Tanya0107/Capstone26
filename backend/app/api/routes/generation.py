"""POST /api/generation — teacher goals in, CurriculumPackage JSON out (FR1–FR4).

Contract (Phase 2): request = GenerationRequest, response = CurriculumPackage.
NFR2b (re-scoped, D13): end-to-end (generate + score + self-correct) must
complete within settings.generation_timeout_seconds for 95% of requests,
the orchestrator enforces the budget internally. The original single 15s
NFR2 now applies to the interactive tutor turn (NFR2a).
"""
from fastapi import APIRouter, Depends

from app.api.deps import require_teacher
from app.core.schemas import CurriculumPackage, GenerationRequest

router = APIRouter()


@router.post("", response_model=CurriculumPackage)
async def generate_curriculum(
    request: GenerationRequest,
    claims: dict = Depends(require_teacher),
) -> CurriculumPackage:
    """Run the 6-stage pipeline via the Orchestrator and persist the draft.

    TODO Phase 3, Step 3.6:
      1. context = await memory_bank.retrieve_context(request)   # RAG (FR6)
      2. package = await orchestrator.run_pipeline(request, context)
      3. module_key = save_curriculum_package(package)           # draft status
      4. return package (with module_key + latency populated)
    """
    raise NotImplementedError
