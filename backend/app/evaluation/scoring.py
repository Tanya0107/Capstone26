"""FR4 — inline algorithmic scoring attached to every generated draft.

Runs INSIDE the NFR2 budget, so it must be fast: compare the draft's lesson
objectives against the closest gold-standard reference unit (if any) and
attach QualityScores. Full threshold evaluation lives in /evaluation and runs
OFFLINE — the Phase B targets are NOT judged per-request here.
"""
from app.core.schemas import CurriculumPackage, QualityScores


def score_package(package: CurriculumPackage) -> QualityScores:
    """TODO Phase 3, Step 3.6: lightweight ROUGE-L vs nearest reference;
    consider skipping BERTScore inline (model load is slow) and computing it
    async post-response, persisted onto the module doc."""
    raise NotImplementedError
