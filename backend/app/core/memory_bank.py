"""Adaptive Learning Module — the Feedback Memory Bank (FR6, Fig 3 Memory Layer).

Flow (Phase 3, Step 3.4):
  1. Teacher saves edits in the Review Dashboard -> POST /api/feedback/edits.
  2. Embed(original_draft), Embed(teacher_edit); semantic_distance = 1 - cosine.
  3. If distance > EDIT_SIGNIFICANCE_THRESHOLD, store a FeedbackMemoryRecord
     with adaptedContextVector = Embed(teacher_edit).
  4. On every new GenerationRequest, the Orchestrator embeds the request,
     retrieves top-k similar memories, and injects them as few-shot context
     ("teachers previously changed X into Y") into the Intake/Lesson agents.

Cold start (book Challenges 3): until real edits accumulate, seed the bank
with high quality exemplar units from evaluation/gold_standard/.

Embeddings use text-embedding-3-large (D2), which supports the Hebrew content
directly. Vector storage and retrieval use Firestore native vector search (D3).
"""
from __future__ import annotations

EDIT_SIGNIFICANCE_THRESHOLD = 0.15  # TODO Phase 3: calibrate empirically


async def ingest_teacher_edit(record) -> "float":
    """Compute semantic distance, persist memory record, return the distance.

    Args:
        record: TeacherEditRecord
    """
    raise NotImplementedError("Implement in Phase 3, Step 3.4")


async def retrieve_context(request) -> list[str]:
    """Return formatted few-shot context strings for the generation pipeline."""
    raise NotImplementedError("Implement in Phase 3, Step 3.4")
