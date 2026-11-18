"""Feedback Memory Bank tests (FR6).

Cases:
  1. Identical draft/edit -> distance ~ 0 -> NOT stored.
  2. Substantive rewrite -> distance > threshold -> stored with vector.
  3. retrieve_context returns k most-similar memories, formatted for prompts.

Embeddings are deterministic fakes (R7), no network and no emulator.
"""
import pytest

from app.core import memory_bank
from app.core.memory_bank import (
    EDIT_SIGNIFICANCE_THRESHOLD,
    MAX_CONTEXT_CHARS,
    MAX_RETRIEVAL_DISTANCE,
    cosine_distance,
    ingest_teacher_edit,
    retrieve_context,
)
from app.core.schemas import TeacherEditRecord

ORIGINAL = "פתרו את התרגיל הבא"
EDITED = "חקרו את הבעיה דרך מצב מהחיים האמיתיים והסבירו את דרך החשיבה"

# Deterministic unit vectors: identical text embeds identically, a rewrite
# embeds orthogonally, which is distance 1.0
VECTORS = {
    ORIGINAL: [1.0, 0.0, 0.0, 0.0],
    EDITED: [0.0, 1.0, 0.0, 0.0],
}


@pytest.fixture
def fake_bank(monkeypatch):
    """Capture writes and serve canned embeddings."""
    saved: list = []

    async def fake_embed(texts, *, timeout_s=None):
        return [VECTORS[t] for t in texts]

    def fake_save(record):
        saved.append(record)
        return f"mem_{len(saved)}"

    monkeypatch.setattr(memory_bank, "embed", fake_embed)
    monkeypatch.setattr(memory_bank, "save_feedback_memory", fake_save)
    return saved


def edit_record(original: str, edited: str) -> TeacherEditRecord:
    return TeacherEditRecord(
        teacher_key="t1", module_key="m1", original_text=original, edited_text=edited
    )


async def test_trivial_edit_not_stored(fake_bank):
    """Case 1: an unchanged draft scores ~0 and never reaches the bank."""
    result = await ingest_teacher_edit(edit_record(ORIGINAL, ORIGINAL))
    assert result.semantic_distance == pytest.approx(0.0, abs=1e-9)
    assert result.stored is False
    assert result.memory_id is None
    assert fake_bank == []


async def test_substantive_edit_stored_with_vector(fake_bank):
    """Case 2: a real rewrite is stored, carrying the edit's own vector so
    future briefs match against what the teacher wanted, not the draft."""
    result = await ingest_teacher_edit(edit_record(ORIGINAL, EDITED))
    assert result.semantic_distance > EDIT_SIGNIFICANCE_THRESHOLD
    assert result.stored is True
    assert result.memory_id == "mem_1"

    [record] = fake_bank
    assert record.adapted_context_vector == VECTORS[EDITED]
    assert ORIGINAL in record.teacher_modifications
    assert EDITED in record.teacher_modifications
    assert record.teacher_key == "t1"


async def test_retrieve_context_formats_memories(monkeypatch, sample_request):
    """Case 3: the nearest memories come back as few shot strings carrying
    both halves of the edit, in the order the vector search returned."""
    async def fake_embed(texts, *, timeout_s=None):
        return [[1.0, 0.0, 0.0, 0.0]]

    def fake_fetch(vector, k=5):
        return [
            {"teacherModifications": "במקום: א\nהמורה העדיף: ב", "vectorDistance": 0.10},
            {"teacherModifications": "במקום: ג\nהמורה העדיף: ד", "vectorDistance": 0.42},
        ]

    monkeypatch.setattr(memory_bank, "embed", fake_embed)
    monkeypatch.setattr(memory_bank, "fetch_similar_memories", fake_fetch)

    context = await retrieve_context(sample_request)
    assert len(context) == 2
    assert "המורה העדיף: ב" in context[0]
    assert "0.10" in context[0]
    assert "המורה העדיף: ד" in context[1]


async def test_retrieve_context_never_fails_generation(monkeypatch, sample_request):
    """Adaptation is an enhancement. An unreachable bank must degrade to no
    context rather than take down a generation request."""
    async def boom(texts, *, timeout_s=None):
        raise RuntimeError("vector search unavailable")

    monkeypatch.setattr(memory_bank, "embed", boom)
    assert await retrieve_context(sample_request) == []


async def test_retrieve_context_respects_char_budget(monkeypatch, sample_request):
    """Context is injected into every pipeline prompt, so it stays bounded
    however many memories the bank returns."""
    async def fake_embed(texts, *, timeout_s=None):
        return [[1.0, 0.0, 0.0, 0.0]]

    def fake_fetch(vector, k=5):
        return [
            {"teacherModifications": "במקום: " + "א" * 5000, "vectorDistance": 0.1}
            for _ in range(20)
        ]

    monkeypatch.setattr(memory_bank, "embed", fake_embed)
    monkeypatch.setattr(memory_bank, "fetch_similar_memories", fake_fetch)

    context = await retrieve_context(sample_request)
    assert sum(len(entry) for entry in context) <= MAX_CONTEXT_CHARS


@pytest.mark.parametrize(
    ("a", "b", "expected"),
    [
        ([1.0, 0.0], [1.0, 0.0], 0.0),
        ([1.0, 0.0], [0.0, 1.0], 1.0),
        ([1.0, 0.0], [-1.0, 0.0], 2.0),
        ([3.0, 0.0], [9.0, 0.0], 0.0),
        ([0.0, 0.0], [1.0, 0.0], 1.0),
    ],
)
def test_cosine_distance(a, b, expected):
    assert cosine_distance(a, b) == pytest.approx(expected, abs=1e-9)


async def test_irrelevant_memories_are_dropped(monkeypatch, sample_request):
    """find_nearest returns k results however far away they are. Without a
    cutoff an unrelated brief gets handed the nearest memories anyway, which
    is worse than no context at all."""
    async def fake_embed(texts, *, timeout_s=None):
        return [[1.0, 0.0, 0.0, 0.0]]

    def fake_fetch(vector, k=5):
        return [
            {"teacherModifications": "במקום: קרוב\nהמורה העדיף: קרוב", "vectorDistance": 0.37},
            {"teacherModifications": "במקום: רחוק\nהמורה העדיף: רחוק", "vectorDistance": 0.74},
        ]

    monkeypatch.setattr(memory_bank, "embed", fake_embed)
    monkeypatch.setattr(memory_bank, "fetch_similar_memories", fake_fetch)

    context = await retrieve_context(sample_request)
    assert len(context) == 1
    assert "קרוב" in context[0]
    assert all("רחוק" not in entry for entry in context)
    assert 0.37 < MAX_RETRIEVAL_DISTANCE < 0.74
