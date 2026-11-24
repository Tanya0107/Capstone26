"""Adaptive Learning Module, the Feedback Memory Bank (FR6, Fig 3 Memory Layer).

Flow:
  1. Teacher saves edits in the Review Dashboard -> POST /api/feedback/edits.
  2. Embed(original_draft), Embed(teacher_edit), semantic_distance = 1 - cosine.
  3. If distance > EDIT_SIGNIFICANCE_THRESHOLD, store a FeedbackMemoryRecord
     with adaptedContextVector = Embed(teacher_edit).
  4. On every new GenerationRequest the Orchestrator embeds the request,
     retrieves top k similar memories and injects them as few shot context
     into the pipeline through state rag_context.

Cold start (book Challenge 3): until real edits accumulate, seed the bank
from the evaluation/gold_standard exemplars.

Embeddings use text-embedding-3-large (D2) at the reduced dimension the
Firestore vector index allows. Storage and retrieval use Firestore native
vector search with COSINE distance (D3), so a returned distance is on the
same 1 minus cosine scale as the stored semanticDistance.
"""
from __future__ import annotations

import json
import logging
import math
from pathlib import Path
from typing import NamedTuple, Optional

from app.core.firestore import (
    count_feedback_memories,
    fetch_similar_memories,
    save_feedback_memory,
)
from app.core.llm import embed
from app.core.schemas import FeedbackMemoryRecord, GenerationRequest, TeacherEditRecord

logger = logging.getLogger(__name__)

# Store an edit only when it is a real rewrite rather than a typo fix.
# Calibration note: 0.15 is the book's starting point and has NOT been
# calibrated against real teacher edits yet. Phase 5 should plot the
# distance distribution of pilot edits and move the threshold to the
# trough between trivial and substantive, recording the plot as evidence.
EDIT_SIGNIFICANCE_THRESHOLD = 0.15

RETRIEVAL_TOP_K = 5
# find_nearest always returns k results however far away they are, so an
# unrelated brief would still be handed the nearest memories. Anything
# beyond this cosine distance is treated as irrelevant and dropped.
# Calibration note: provisional, from the Step 3.4 demo where a matching
# brief scored 0.32 to 0.37 and an unrelated one 0.66 to 0.74. Recalibrate
# in Phase 5 on real pilot memories, same as the ingest threshold.
MAX_RETRIEVAL_DISTANCE = 0.50
# Retrieved context is injected into every pipeline prompt, so it is capped
# to keep it from crowding out the brief itself.
MAX_MEMORY_CHARS = 600
MAX_CONTEXT_CHARS = 2400

GOLD_STANDARD_DIR = Path(__file__).resolve().parents[3] / "evaluation" / "gold_standard"


class IngestResult(NamedTuple):
    semantic_distance: float
    stored: bool
    memory_id: Optional[str] = None


def cosine_distance(a: list[float], b: list[float]) -> float:
    """1 minus cosine similarity, clamped to [0, 2].

    embed L2 normalizes, so this is usually a dot product, but the norms
    are computed anyway so the helper is correct for any input.
    """
    norm_a = math.sqrt(sum(x * x for x in a))
    norm_b = math.sqrt(sum(x * x for x in b))
    if norm_a == 0 or norm_b == 0:
        return 1.0
    similarity = sum(x * y for x, y in zip(a, b)) / (norm_a * norm_b)
    return max(0.0, min(2.0, 1.0 - similarity))


def format_modification(original: str, edited: str) -> str:
    """The stored few shot body, written for the generator to imitate."""
    return f"במקום: {original}\nהמורה העדיף: {edited}"


def _truncate(text: str, limit: int) -> str:
    text = text.strip()
    return text if len(text) <= limit else text[: limit - 1].rstrip() + "…"


async def ingest_teacher_edit(
    record: TeacherEditRecord, *, timeout_s: Optional[float] = None
) -> IngestResult:
    """Compute the semantic distance of one teacher edit and store it when
    the edit is substantive. Returns the distance, whether it was stored,
    and the new memory id."""
    original_vector, edited_vector = await embed(
        [record.original_text, record.edited_text], timeout_s=timeout_s
    )
    distance = cosine_distance(original_vector, edited_vector)
    if distance <= EDIT_SIGNIFICANCE_THRESHOLD:
        logger.info(
            "Edit on module %s scored %.3f, at or below the %.2f threshold, not stored",
            record.module_key,
            distance,
            EDIT_SIGNIFICANCE_THRESHOLD,
        )
        return IngestResult(distance, False)

    memory_id = save_feedback_memory(
        FeedbackMemoryRecord(
            teacher_key=record.teacher_key,
            module_key=record.module_key,
            teacher_modifications=format_modification(
                record.original_text, record.edited_text
            ),
            semantic_distance=distance,
            adapted_context_vector=edited_vector,
        )
    )
    logger.info(
        "Stored memory %s for module %s, distance %.3f",
        memory_id,
        record.module_key,
        distance,
    )
    return IngestResult(distance, True, memory_id)


def request_query_text(request: GenerationRequest) -> str:
    """The text a new brief is matched against. Mirrors what a teacher edit
    is about: subject, level and the substance of the goals."""
    topics = ", ".join(request.topics)
    return (
        f"מקצוע: {request.subject}. כיתה: {request.grade_level}. "
        f"רמת קושי: {request.difficulty_level}. מטרות: {request.goals}. "
        f"נושאים: {topics}"
    )


async def retrieve_context(
    request: GenerationRequest,
    *,
    k: int = RETRIEVAL_TOP_K,
    timeout_s: Optional[float] = None,
) -> list[str]:
    """Return few shot context strings for the generation pipeline.

    Never fails a generation: a memory bank that is empty, unreachable or
    slow yields no context rather than an error, because adaptation is an
    enhancement and the brief alone is always enough to generate from.
    """
    try:
        [query_vector] = await embed([request_query_text(request)], timeout_s=timeout_s)
        memories = fetch_similar_memories(query_vector, k=k)
    except Exception:
        logger.exception("Memory retrieval failed, continuing without context")
        return []

    context: list[str] = []
    budget = MAX_CONTEXT_CHARS
    for memory in memories:
        body = _truncate(memory.get("teacherModifications", ""), MAX_MEMORY_CHARS)
        if not body:
            continue
        distance = memory.get("vectorDistance")
        if isinstance(distance, (int, float)) and distance > MAX_RETRIEVAL_DISTANCE:
            continue
        header = "העדפת עריכה קודמת של מורה"
        if isinstance(distance, (int, float)):
            header += f" (מרחק {distance:.2f})"
        entry = f"{header}:\n{body}\nהעדיפו סגנון דומה."
        if len(entry) > budget:
            break
        context.append(entry)
        budget -= len(entry)
    logger.info("Retrieved %d memories as pipeline context", len(context))
    return context


def _exemplar_text(unit: dict) -> str:
    """Representative text of a gold unit, used as its memory vector."""
    parts = [unit.get("title", "")]
    for lesson in unit.get("lessons", [])[:2]:
        parts.append(lesson.get("title", ""))
        parts.extend(lesson.get("objectives", [])[:2])
        parts.append(lesson.get("hook", ""))
        for exercise in lesson.get("exercises", [])[:2]:
            parts.append(exercise.get("prompt", ""))
    return " ".join(part for part in parts if part)


async def seed_cold_start(*, timeout_s: Optional[float] = None) -> int:
    """Seed the bank from evaluation/gold_standard when it is empty.

    These units are style exemplars for cold start guidance only. They are
    separate from their role as metric references in Phase 5, where a unit
    counts only once validated, so a DRAFT unit may seed the bank but may
    not back a reported metric (R1).
    """
    if count_feedback_memories():
        return 0
    if not GOLD_STANDARD_DIR.is_dir():
        logger.warning("No gold standard directory at %s", GOLD_STANDARD_DIR)
        return 0

    units: list[tuple[str, dict]] = []
    for path in sorted(GOLD_STANDARD_DIR.glob("*.json")):
        if path.name.startswith(("TEMPLATE", "brief_")):
            continue
        try:
            unit = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            logger.warning("Skipping unreadable gold unit %s", path.name)
            continue
        if _exemplar_text(unit).strip():
            units.append((path.stem, unit))
    if not units:
        return 0

    vectors = await embed([_exemplar_text(u) for _, u in units], timeout_s=timeout_s)
    for (stem, unit), vector in zip(units, vectors):
        save_feedback_memory(
            FeedbackMemoryRecord(
                teacher_key="REFERENCE",
                module_key=stem,
                teacher_modifications=(
                    f"יחידת ייחוס מאושרת במקצוע {unit.get('subject', '')}, "
                    f"כיתה {unit.get('grade_level', '')}: «{unit.get('title', '')}».\n"
                    f"המורה העדיף: סגנון חקר מבוסס הקשר מהחיים, כמו ביחידה הזו."
                ),
                # A seeded exemplar is not a measured edit distance. 1.0 marks
                # it as seeded so pilot edit statistics can exclude these.
                semantic_distance=1.0,
                adapted_context_vector=vector,
            )
        )
    logger.info("Cold start seeded %d gold standard exemplars", len(units))
    return len(units)
