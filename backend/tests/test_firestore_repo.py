"""Repository round trip tests against the Firestore emulator (Step 2.3).

Skipped automatically when the emulator is not running, per conftest
principles. CI runs the backend job without an emulator, so these are a
local and rules-job concern.
"""
import socket

import pytest

from app.core.schemas import (
    AssessmentBundle,
    CriticReport,
    CurriculumPackage,
    Exercise,
    FeedbackMemoryRecord,
    LessonUnit,
    QualityScores,
    SocraticHint,
    TelemetryEvent,
)


def _emulator_running(host: str = "localhost", port: int = 8080) -> bool:
    try:
        with socket.create_connection((host, port), timeout=0.5):
            return True
    except OSError:
        return False


pytestmark = pytest.mark.skipif(
    not _emulator_running(), reason="Firestore emulator is not running"
)


@pytest.fixture
def sample_package() -> CurriculumPackage:
    def exercise(order: int) -> Exercise:
        return Exercise(
            order=order,
            prompt=f"Exercise {order} prompt",
            correct_answer=f"answer {order}",
            socratic_hints=[SocraticHint(hint_order=1, hint_text="What do you know so far?")],
            scaffold_steps=["read", "plan", "solve"],
        )

    return CurriculumPackage(
        title="Fractions in the kitchen",
        subject="math",
        grade_level="5",
        difficulty_level=3,
        weekly_sequence=["week 1 intro", "week 2 practice"],
        lessons=[
            LessonUnit(
                title="Half of a half",
                objectives=["understand unit fractions"],
                hook="A recipe for two becomes a recipe for one",
                exercises=[exercise(1), exercise(2)],
            ),
            LessonUnit(
                title="Comparing fractions",
                objectives=["order fractions"],
                hook="Which slice is bigger?",
                exercises=[exercise(3)],
            ),
        ],
        assessment=AssessmentBundle(
            rubric="3 levels", diagnostics=["pre q1"], exit_tickets=["exit q1"]
        ),
        critic_report=CriticReport(approved=True, issues=[], regeneration_cycles_used=0),
        quality_scores=QualityScores(),
    )


def test_curriculum_package_round_trip(sample_package):
    from app.core.firestore import get_db, save_curriculum_package

    module_key = save_curriculum_package(sample_package, teacher_key="t_repo")
    assert module_key
    assert sample_package.module_key == module_key

    db = get_db()
    module_doc = db.collection("curriculumModules").document(module_key).get().to_dict()
    assert module_doc["title"] == "Fractions in the kitchen"
    assert module_doc["creatorTeacherKey"] == "t_repo"
    assert module_doc["status"] == "draft"
    assert module_doc["assignedStudentKeys"] == []
    assert len(module_doc["lessons"]) == 2

    # Decoupling: exercises are separate docs linked by moduleKey
    exercises = list(
        db.collection("exercises").where("moduleKey", "==", module_key).stream()
    )
    assert len(exercises) == 3
    exercise_ids = {snap.id for snap in exercises}
    for lesson_meta in module_doc["lessons"]:
        assert set(lesson_meta["exerciseKeys"]) <= exercise_ids

    # R6: no answer fields anywhere a student could read
    assert "correctAnswer" not in str(module_doc)
    for snap in exercises:
        doc = snap.to_dict()
        assert "correctAnswer" not in doc
        assert "socraticHints" not in doc
        assert doc["assignedStudentKeys"] == []

    # Solutions carry the answers under the same ids
    for snap in exercises:
        solution = db.collection("exerciseSolutions").document(snap.id).get().to_dict()
        assert solution["moduleKey"] == module_key
        assert solution["correctAnswer"].startswith("answer")
        assert solution["socraticHints"][0]["hintText"]


def test_telemetry_append_and_memory_round_trip():
    from app.core.firestore import (
        append_telemetry_event,
        fetch_similar_memories,
        get_db,
        save_feedback_memory,
    )

    append_telemetry_event(
        TelemetryEvent(
            student_key="s_repo",
            exercise_key="e_repo",
            assignment_key="a_repo",
            att_seconds=42.0,
            hsrc_count=2,
        )
    )
    db = get_db()
    events = list(
        db.collection("telemetryEvents").where("studentKey", "==", "s_repo").stream()
    )
    assert events
    stored = events[0].to_dict()
    assert stored["attSeconds"] == 42.0
    assert stored["timestamp"] is not None

    memory_id = save_feedback_memory(
        FeedbackMemoryRecord(
            teacher_key="t_repo",
            module_key="m_repo",
            teacher_modifications="Prefer word problems over bare drills",
            semantic_distance=0.42,
            adapted_context_vector=[0.1, 0.2, 0.3],
        )
    )
    assert memory_id
    recent = fetch_similar_memories(vector=[0.1, 0.2, 0.3], k=5)
    assert any(m["memoryId"] == memory_id for m in recent)
