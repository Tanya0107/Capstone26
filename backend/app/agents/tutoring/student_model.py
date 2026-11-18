"""Live Student Model, tracks knowledge gaps and misconceptions per session.

Per turn state is held in process (D16): no Redis for the pilot, kept
behind the small store interface in session_store so a shared backend can
replace it without touching the tutor. Durable progress belongs in
studentProgress, this is the conversational working memory.
"""
from __future__ import annotations

from typing import Optional

# Consecutive non correct attempts on one exercise before the hint ladder
# escalates on its own, independent of affective state.
ESCALATE_AFTER_FAILURES = 2
MAX_TRACKED_ITEMS = 10


class StudentModel:
    def __init__(self, student_key: str, assignment_key: str) -> None:
        self.student_key = student_key
        self.assignment_key = assignment_key
        self.misconceptions: list[str] = []
        self.knowledge_gaps: list[str] = []
        self.attempts: dict[str, int] = {}
        self.consecutive_failures: dict[str, int] = {}
        self.last_hint_level: dict[str, int] = {}

    def update(
        self,
        student_message: str,
        evaluation: dict,
        exercise_key: Optional[str] = None,
    ) -> None:
        """Fold one evaluated attempt into the session state.

        Off task messages are not attempts at the exercise, so they never
        count as failures. Treating chat as failure would march the hint
        ladder forward and hand out scaffolding nobody asked for.
        """
        category = evaluation.get("category", "off_task")
        if exercise_key is None:
            return
        if category == "off_task":
            return

        self.attempts[exercise_key] = self.attempts.get(exercise_key, 0) + 1
        if category == "correct":
            self.consecutive_failures[exercise_key] = 0
        else:
            self.consecutive_failures[exercise_key] = (
                self.consecutive_failures.get(exercise_key, 0) + 1
            )

        for field, bucket in (
            ("misconception", self.misconceptions),
            ("knowledge_gap", self.knowledge_gaps),
        ):
            value = (evaluation.get(field) or "").strip()
            if value and value not in bucket:
                bucket.append(value)
                del bucket[:-MAX_TRACKED_ITEMS]

    def should_escalate(self, exercise_key: str) -> bool:
        return (
            self.consecutive_failures.get(exercise_key, 0) >= ESCALATE_AFTER_FAILURES
        )

    def record_hint(self, exercise_key: str, level: int) -> None:
        self.last_hint_level[exercise_key] = level
