"""Step 3.4 acceptance demo, adaptive behaviour of the memory bank (FR6).

Brief -> substantive teacher edit -> similar brief -> show the retrieved
context now carries that edit. Uses real embeddings and the Firestore
emulator, and writes evidence to evaluation/results/dev_runs.

DEV evidence only (R1).

Run from backend/ with the emulators up:
    .venv/bin/python -u -m scripts.demo_memory_bank
"""
from __future__ import annotations

import asyncio
import json
import logging
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.config import get_settings
from app.core import memory_bank
from app.core.firestore import get_db
from app.core.schemas import GenerationRequest, TeacherEditRecord

RESULTS = Path(__file__).resolve().parents[2] / "evaluation" / "results" / "dev_runs"

FIRST_BRIEF = GenerationRequest(
    teacher_key="t_demo", school_key="s_demo", subject="math",
    goals="להעמיק את הבנת השברים דרך בעיות בישול ומתכונים מהעולם האמיתי",
    topics=["שברים", "יחסים"], grade_level="5", difficulty_level=3,
)
# A later, similar brief. Same subject and level, different wording, so the
# match has to come from meaning rather than from repeated strings.
SIMILAR_BRIEF = GenerationRequest(
    teacher_key="t_demo", school_key="s_demo", subject="math",
    goals="ללמד שברים שקולים והשוואת שברים דרך פעילויות מעשיות במטבח",
    topics=["שברים שקולים", "השוואת שברים"], grade_level="5", difficulty_level=3,
)
UNRELATED_BRIEF = GenerationRequest(
    teacher_key="t_demo", school_key="s_demo", subject="history",
    goals="להשוות בין תרבויות קדומות דרך ניתוח מקורות ראשוניים",
    topics=["מסופוטמיה"], grade_level="6", difficulty_level=3,
)

TRIVIAL_EDIT = TeacherEditRecord(
    teacher_key="t_demo", module_key="m_demo",
    original_text="חשבו כמה זה 3/4 ועוד 2/3.",
    edited_text="חשבו כמה זה 3/4 ועוד 2/3",  # punctuation only
)
SUBSTANTIVE_EDIT = TeacherEditRecord(
    teacher_key="t_demo", module_key="m_demo",
    original_text="חשבו כמה זה 3/4 ועוד 2/3.",
    edited_text=(
        "הביאו מתכון אמיתי מהבית שמשתמש בשברים, הכינו אותו בכמות כפולה, "
        "ותעדו אילו שברים הייתם צריכים לחבר ואיך פתרתם זאת בפועל"
    ),
)


def clear_bank() -> None:
    for snap in get_db().collection("feedbackMemoryBank").stream():
        snap.reference.delete()


async def main() -> None:
    logging.basicConfig(level=logging.INFO, format="   %(message)s")
    settings = get_settings()
    if not settings.openai_api_key:
        sys.exit("OPENAI_API_KEY is required for real embeddings")
    RESULTS.mkdir(parents=True, exist_ok=True)
    evidence: dict = {
        "label": "DEV evidence, not an evaluation result (R1)",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "embedding_model": settings.embedding_model,
        "embedding_dimensions": settings.embedding_dimensions,
        "threshold": memory_bank.EDIT_SIGNIFICANCE_THRESHOLD,
    }

    print("1. empty the bank, then cold start from the gold standard")
    clear_bank()
    seeded = await memory_bank.seed_cold_start()
    evidence["cold_start_seeded"] = seeded
    print(f"   seeded {seeded} exemplar(s)")

    print("2. retrieve for the FIRST brief, before any teacher edit")
    before = await memory_bank.retrieve_context(FIRST_BRIEF)
    evidence["context_before_edit"] = before
    print(f"   {len(before)} memory/memories, none of them a teacher edit yet")

    print("3. a trivial edit (punctuation only)")
    trivial = await memory_bank.ingest_teacher_edit(TRIVIAL_EDIT)
    evidence["trivial_edit"] = {
        "distance": round(trivial.semantic_distance, 4), "stored": trivial.stored
    }
    print(f"   distance {trivial.semantic_distance:.4f}, stored={trivial.stored}")

    print("4. a substantive rewrite by the teacher")
    real = await memory_bank.ingest_teacher_edit(SUBSTANTIVE_EDIT)
    evidence["substantive_edit"] = {
        "distance": round(real.semantic_distance, 4), "stored": real.stored,
        "memory_id": real.memory_id,
    }
    print(f"   distance {real.semantic_distance:.4f}, stored={real.stored}")

    print("5. retrieve for a SIMILAR but differently worded brief")
    after = await memory_bank.retrieve_context(SIMILAR_BRIEF)
    evidence["context_after_edit"] = after
    marker = "מתכון אמיתי מהבית"
    hit = [i for i, c in enumerate(after) if marker in c]
    evidence["edit_memory_rank"] = (hit[0] + 1) if hit else None
    print(f"   {len(after)} memories, teacher edit at rank "
          f"{evidence['edit_memory_rank']} of {len(after)}")

    print("6. retrieve for an UNRELATED brief, as a control")
    control = await memory_bank.retrieve_context(UNRELATED_BRIEF)
    evidence["control_unrelated_brief"] = control
    evidence["control_contains_edit"] = any(marker in c for c in control)

    # The guide's bar is that a similar brief retrieves the edit. Rank is
    # recorded but not asserted: a seeded exemplar outranking one edit is
    # reasonable, both reach the generator. The control must stay clean.
    ok = (
        not trivial.stored
        and real.stored
        and evidence["edit_memory_rank"] is not None
        and not evidence["control_contains_edit"]
    )
    evidence["acceptance_met"] = ok
    (RESULTS / "memory_bank_demo.json").write_text(
        json.dumps(evidence, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(f"\nacceptance_met={ok}  ->  evaluation/results/dev_runs/memory_bank_demo.json")


if __name__ == "__main__":
    asyncio.run(main())
