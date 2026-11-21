"""POST /api/generation, teacher goals in, CurriculumPackage JSON out (FR1 to FR4).

Contract (Phase 2): request = GenerationRequest, response = CurriculumPackage.
GET /api/generation/subjects was added post freeze for the Step 4.2 Goals
screen, see docs/API_CONTRACT.md.
NFR2b (re-scoped, D13): end to end (generate plus score plus self correct)
must complete within settings.generation_timeout_seconds for 95% of
requests, the orchestrator enforces the budget internally and
GenerationTimeoutError becomes the 504 body the frontend degrades on
(NFR7). The original single 15s NFR2 now applies to the interactive tutor
turn (NFR2a).

Order of work, and why:
  1. Validate the subject before spending anything. The standards loader
     and the critic strategy map both reject an unknown subject, but they
     do so at stages 1 and 5, after minutes of model calls. A 422 here
     costs nothing.
  2. Retrieve memory bank context (FR6). Never fatal, see retrieve_context.
  3. Run the pipeline under the NFR2b budget.
  4. Score the draft inline (FR4). Pure Python, no model load.
  5. Persist, then schedule the slow BERTScore off the response path (D17).
"""
import asyncio

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException

from app.agents.orchestrator import run_pipeline
from app.agents.standards.loader import (
    UnknownSubjectError,
    available_subjects,
    corpus_profile,
)
from app.api.deps import require_teacher
from app.config import SUBJECT_TYPES, subject_type
from app.core import memory_bank
from app.core.firestore import save_curriculum_package
from app.core.schemas import (
    CurriculumPackage,
    GenerationRequest,
    SubjectCatalog,
    SubjectOption,
)
from app.evaluation.scoring import attach_bertscore, score_package

router = APIRouter()


def _validate_subject(subject: str) -> None:
    """Reject a subject the pipeline cannot serve, with 422 (D8).

    Two separate corpora must know the subject: the curated standards
    snapshot the Intake Agent cites from, and the critic strategy map that
    picks between an independent solve and claim verification.
    """
    try:
        subject_type(subject)
    except ValueError as exc:
        raise HTTPException(
            status_code=422,
            detail=f"{exc} Classified subjects: {sorted(SUBJECT_TYPES)}",
        ) from exc
    if subject not in available_subjects():
        raise HTTPException(
            status_code=422,
            detail=(
                f"No standards corpus for subject '{subject}'. "
                f"Available: {available_subjects()}"
            ),
        )


@router.get("/subjects", response_model=SubjectCatalog)
async def list_subjects(claims: dict = Depends(require_teacher)) -> SubjectCatalog:
    """Subjects and grades the Goals screen may offer (FR1, D8).

    The form needs this because the two facts it must respect live in the
    backend. Which subjects are servable is the intersection of the
    standards snapshots on disk and the critic strategy map, exactly the
    pair _validate_subject below checks. Which grades are usable differs
    per subject, since the snapshots do not cover the same range, and a
    grade outside a snapshot yields an empty standards slice rather than an
    error. Hardcoding either in the frontend would drift the moment a
    snapshot is added or extended.

    draft_corpus is carried through so the form can label a subject whose
    snapshot is still pending team validation, instead of presenting a
    draft as settled (R1).
    """
    options = [
        SubjectOption(
            subject=subject,
            subject_type=SUBJECT_TYPES[subject],
            grades=profile["grades"],
            draft_corpus=profile["draft"],
        )
        for subject, profile in (
            (subject, corpus_profile(subject))
            for subject in available_subjects()
            if subject in SUBJECT_TYPES
        )
        if profile["grades"]
    ]
    return SubjectCatalog(subjects=options)


@router.post("", response_model=CurriculumPackage)
async def generate_curriculum(
    request: GenerationRequest,
    background_tasks: BackgroundTasks,
    claims: dict = Depends(require_teacher),
) -> CurriculumPackage:
    """Run the 6 stage pipeline via the Orchestrator and persist the draft.

    A teacher may only generate under their own key, so the module's
    creatorTeacherKey always matches the caller the security rules will
    check on every later read.
    """
    if request.teacher_key != claims.get("uid"):
        raise HTTPException(
            status_code=403, detail="Generation must use your own teacherKey"
        )
    _validate_subject(request.subject)

    rag_context = await memory_bank.retrieve_context(request)
    try:
        package = await run_pipeline(request, rag_context)
    except UnknownSubjectError as exc:
        # Guarded above, so this means the corpus changed under a live
        # process. Still a client correctable 422, never a 500.
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    package.quality_scores = score_package(package)
    # One batched multi document commit, the largest blocking IO on any
    # request path, so it goes to a worker thread rather than stalling the
    # event loop for every other in flight request
    module_key = await asyncio.to_thread(
        save_curriculum_package, package, claims["uid"]
    )
    package.module_key = module_key
    background_tasks.add_task(attach_bertscore, module_key, package)
    return package
