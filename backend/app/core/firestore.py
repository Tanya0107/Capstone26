"""Firebase Admin SDK client + typed repository helpers.

The backend is the ONLY writer of feedbackMemoryBank and the only component
allowed to read exercises' correctAnswer/socraticHints on behalf of students
(FR11 — hints are served, answers are never exposed).
"""
from __future__ import annotations

import os
from functools import lru_cache

import firebase_admin
from firebase_admin import credentials, firestore

from app.config import get_settings


@lru_cache
def get_db() -> firestore.Client:
    settings = get_settings()
    if settings.use_firestore_emulator:
        os.environ.setdefault("FIRESTORE_EMULATOR_HOST", settings.firestore_emulator_host)
    if not firebase_admin._apps:
        # Emulator mode does not require real credentials
        cred = credentials.ApplicationDefault() if not settings.use_firestore_emulator else None
        firebase_admin.initialize_app(cred, {"projectId": settings.firebase_project_id or "demo-project"})
    return firestore.client()


# ---- Repository sketches (implement in Phase 2, Step 2.3) ----

def save_curriculum_package(package) -> str:
    """Persist a CurriculumPackage into curriculumModules + exercises (Fig 4).

    Returns the new moduleKey. Exercises are decoupled docs linked by moduleKey
    to avoid document-size bottlenecks (book: Fig 4, Content Bank).
    """
    raise NotImplementedError


def append_telemetry_event(event) -> None:
    """Append-only write into telemetryEvents (NFR5: keys only, no PII)."""
    raise NotImplementedError


def save_feedback_memory(record) -> str:
    raise NotImplementedError


def fetch_similar_memories(vector: list[float], k: int = 5) -> list[dict]:
    """RAG retrieval for the Orchestrator (Fig 3, Memory Layer).

    Decided (docs/DECISIONS.md D3): Firestore native vector search.
    Implement with a Vector field on feedbackMemoryBank docs and
    collection.find_nearest with COSINE distance. Requires a single field
    vector index, added to firestore.indexes.json in Phase 3, Step 3.4.
    """
    raise NotImplementedError
