"""Live Student Model — tracks knowledge gaps and misconceptions per session.

Persisted lightly to studentProgress; rich per-turn state stays in memory
(OPEN QUESTION Q7: Redis session cache vs in-process dict for the pilot).
"""


class StudentModel:
    def __init__(self, student_key: str, assignment_key: str) -> None:
        self.student_key = student_key
        self.assignment_key = assignment_key
        self.misconceptions: list[str] = []
        self.knowledge_gaps: list[str] = []

    def update(self, student_message: str, evaluation: dict) -> None:
        raise NotImplementedError("Phase 3, Step 3.5")
