"""Standards corpus loader (D4, D8).

One curated JSON snapshot per subject under il_moe/. The Intake Agent
receives the grade slice and may only cite IDs present in it. A missing
subject file surfaces as UnknownSubjectError, which the route layer turns
into a 422, never a silent fallback.
"""
from __future__ import annotations

import json
from pathlib import Path

CORPUS_DIR = Path(__file__).parent / "il_moe"


class UnknownSubjectError(Exception):
    """The requested subject has no curated standards corpus."""


def load_standards(subject: str, grade: str) -> list[dict]:
    """Return the grade filtered standards slice for a subject.

    Entries flagged with a grade_note are treated as cross grade skills
    and included for every grade.
    """
    corpus_path = CORPUS_DIR / f"{subject}.json"
    if not corpus_path.exists():
        raise UnknownSubjectError(
            f"No standards corpus for subject '{subject}' (expected {corpus_path.name})"
        )
    corpus = json.loads(corpus_path.read_text(encoding="utf-8"))
    entries = corpus.get("standards", [])
    return [
        entry
        for entry in entries
        if entry.get("grade") == grade or entry.get("grade_note")
    ]


def available_subjects() -> list[str]:
    return sorted(path.stem for path in CORPUS_DIR.glob("*.json"))
