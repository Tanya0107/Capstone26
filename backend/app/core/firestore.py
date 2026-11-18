"""Firebase Admin SDK client + typed repository helpers.

The backend is the ONLY writer of feedbackMemoryBank and the only component
allowed to read exerciseSolutions on behalf of students (FR11, R6, D11).
All docs are stored camelCase to match models.ts and the security rules.
"""
from __future__ import annotations

import os
from functools import lru_cache

import firebase_admin
import google.auth.credentials
from google.cloud.firestore_v1.base_vector_query import DistanceMeasure
from google.cloud.firestore_v1.vector import Vector
from firebase_admin import credentials, firestore
from google.cloud import firestore as google_firestore

from app.config import get_settings
from app.core.schemas import (
    CurriculumModule,
    CurriculumPackage,
    ExerciseSolution,
    FeedbackMemoryRecord,
    TelemetryEvent,
)


@lru_cache
def get_db() -> google_firestore.Client:
    settings = get_settings()
    project_id = settings.firebase_project_id or "demo-project"
    if settings.use_firestore_emulator:
        # The Admin SDK insists on real credentials even against the
        # emulator, so build the underlying client with anonymous ones.
        os.environ.setdefault("FIRESTORE_EMULATOR_HOST", settings.firestore_emulator_host)
        return google_firestore.Client(
            project=project_id,
            credentials=google.auth.credentials.AnonymousCredentials(),
        )
    if not firebase_admin._apps:
        firebase_admin.initialize_app(
            credentials.ApplicationDefault(), {"projectId": project_id}
        )
    return firestore.client()


def save_curriculum_package(package: CurriculumPackage, teacher_key: str) -> str:
    """Persist a CurriculumPackage into curriculumModules + exercises +
    exerciseSolutions in one batched write (Fig 4, D11). Returns the new
    moduleKey and fills module_key and exercise_id fields on the package.

    Exercises are decoupled docs linked by moduleKey to avoid document size
    bottlenecks. Answer fields go only to exerciseSolutions. The module doc
    keeps lesson metadata with exerciseKeys so the teacher Review Dashboard
    can reassemble the full package from its readable collections.
    """
    db = get_db()
    batch = db.batch()
    module_ref = db.collection("curriculumModules").document()

    lessons_meta = []
    for lesson in package.lessons:
        exercise_keys = []
        for exercise in lesson.exercises:
            exercise_ref = db.collection("exercises").document()
            solution_ref = db.collection("exerciseSolutions").document(exercise_ref.id)
            exercise.exercise_id = exercise_ref.id
            exercise.module_key = module_ref.id
            batch.set(exercise_ref, {
                "moduleKey": module_ref.id,
                "order": exercise.order,
                "prompt": exercise.prompt,
                "scaffoldSteps": exercise.scaffold_steps,
                "assignedStudentKeys": [],
            })
            solution = ExerciseSolution(
                solution_id=exercise_ref.id,
                exercise_key=exercise_ref.id,
                module_key=module_ref.id,
                correct_answer=exercise.correct_answer,
                socratic_hints=exercise.socratic_hints,
            )
            batch.set(solution_ref, solution.model_dump(by_alias=True, exclude={"solution_id"}))
            exercise_keys.append(exercise_ref.id)
        lessons_meta.append({
            "title": lesson.title,
            "objectives": lesson.objectives,
            "hook": lesson.hook,
            "exerciseKeys": exercise_keys,
        })

    module = CurriculumModule(
        module_id=module_ref.id,
        title=package.title,
        subject=package.subject,
        grade_level=package.grade_level,
        difficulty_level=package.difficulty_level,
        creator_teacher_key=teacher_key,
    )
    module_doc = module.model_dump(by_alias=True, exclude={"module_id", "created_at"})
    module_doc.update({
        "createdAt": firestore.SERVER_TIMESTAMP,
        "weeklySequence": package.weekly_sequence,
        "lessons": lessons_meta,
        "assessment": package.assessment.model_dump(by_alias=True),
        "criticReport": package.critic_report.model_dump(by_alias=True),
        "qualityScores": package.quality_scores.model_dump(by_alias=True),
        "generationLatencySeconds": package.generation_latency_seconds,
    })
    batch.set(module_ref, module_doc)
    batch.commit()

    package.module_key = module_ref.id
    return module_ref.id


def append_telemetry_event(event: TelemetryEvent) -> None:
    """Append only write into telemetryEvents (NFR5, keys only, no PII)."""
    db = get_db()
    ref = db.collection("telemetryEvents").document()
    doc = event.model_dump(by_alias=True, exclude={"event_id", "timestamp"})
    doc["timestamp"] = event.timestamp or firestore.SERVER_TIMESTAMP
    ref.set(doc)


def save_feedback_memory(record: FeedbackMemoryRecord) -> str:
    """Store one teacher edit memory (FR6). Returns the new memoryId.

    adapted_context_vector is stored as a Firestore Vector so find_nearest
    can search it, backed by the single field vector index in
    firebase/firestore.indexes.json (D3).
    """
    db = get_db()
    ref = db.collection("feedbackMemoryBank").document()
    doc = record.model_dump(by_alias=True, exclude={"memory_id", "created_at"})
    doc["adaptedContextVector"] = Vector(record.adapted_context_vector)
    doc["createdAt"] = firestore.SERVER_TIMESTAMP
    ref.set(doc)
    return ref.id


def fetch_similar_memories(vector: list[float], k: int = 5) -> list[dict]:
    """RAG retrieval for the Orchestrator (Fig 3, Memory Layer).

    Firestore native vector search with COSINE distance (D3). The returned
    distance is 1 minus cosine similarity, so smaller is more similar, the
    same scale as the stored semanticDistance.
    """
    db = get_db()
    query = db.collection("feedbackMemoryBank").find_nearest(
        vector_field="adaptedContextVector",
        query_vector=Vector(vector),
        limit=k,
        distance_measure=DistanceMeasure.COSINE,
        distance_result_field="vectorDistance",
    )
    results = []
    for snap in query.stream():
        doc = snap.to_dict()
        doc["memoryId"] = snap.id
        # The stored Vector is not JSON serializable and callers only need
        # the text, drop it rather than leak it into prompt context
        doc.pop("adaptedContextVector", None)
        results.append(doc)
    return results


def count_feedback_memories(limit: int = 1) -> int:
    """Cheap emptiness probe for the cold start loader."""
    db = get_db()
    return sum(1 for _ in db.collection("feedbackMemoryBank").limit(limit).stream())
