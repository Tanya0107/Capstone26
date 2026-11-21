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


def _grade_sort_key(grade: str) -> tuple[int, str]:
    """Order grades numerically so 10 follows 9 rather than preceding 4."""
    return (int(grade), "") if grade.isdigit() else (10**6, grade)


def corpus_profile(subject: str) -> dict:
    """What the Goals screen needs to know about one subject snapshot.

    grades lists only the grades carrying an explicit grade value. A grade
    missing from it would hand the Intake Agent an empty standards slice,
    which is a silently poor unit rather than an error, so the FR1 form
    offers these and nothing else. Cross grade entries carry a grade_note
    instead of a grade and apply to every grade, so they are deliberately
    not listed as grades of their own.

    draft reports draft_pending_validation, which the UI must surface,
    since a unit built on an unvalidated snapshot is not evidence (R1).
    """
    corpus_path = CORPUS_DIR / f"{subject}.json"
    if not corpus_path.exists():
        raise UnknownSubjectError(
            f"No standards corpus for subject '{subject}' (expected {corpus_path.name})"
        )
    corpus = json.loads(corpus_path.read_text(encoding="utf-8"))
    entries = corpus.get("standards", [])
    grades = sorted(
        {entry["grade"] for entry in entries if entry.get("grade")},
        key=_grade_sort_key,
    )
    return {
        "grades": grades,
        "draft": bool(corpus.get("draft_pending_validation")),
        "cross_grade_entries": sum(1 for e in entries if e.get("grade_note")),
    }
