"""Tutor session state storage (D16).

In process for the pilot. Its failure modes are known and accepted: state
is lost on restart, and it is wrong across multiple worker processes,
where turn two can land on a process that never saw turn one. Run the
pilot single process. The interface exists so a shared backend can be
dropped in for production without touching the tutor.
"""
from __future__ import annotations

from typing import Protocol

from app.agents.tutoring.student_model import StudentModel


class SessionStore(Protocol):
    def get_or_create(self, student_key: str, assignment_key: str) -> StudentModel: ...
    def clear(self) -> None: ...


class InProcessSessionStore:
    def __init__(self) -> None:
        self._models: dict[tuple[str, str], StudentModel] = {}

    def get_or_create(self, student_key: str, assignment_key: str) -> StudentModel:
        key = (student_key, assignment_key)
        if key not in self._models:
            self._models[key] = StudentModel(student_key, assignment_key)
        return self._models[key]

    def clear(self) -> None:
        self._models.clear()


default_store: SessionStore = InProcessSessionStore()
