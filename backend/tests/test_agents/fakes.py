"""All fake pipeline agents for orchestrator graph tests (Step 3.2, R7)."""
import asyncio

from app.core.schemas import (
    AssessmentBundle,
    CriticIssue,
    CriticReport,
    CurriculumPackage,
    Exercise,
    LessonUnit,
    QualityScores,
)


def sample_lessons() -> list[LessonUnit]:
    return [
        LessonUnit(
            title="Half of a half",
            objectives=["understand unit fractions"],
            hook="A recipe for two becomes a recipe for one",
            exercises=[
                Exercise(order=1, prompt="How much is half of a half?", correct_answer="1/4")
            ],
        )
    ]


class FakeStage:
    """Writes fixed keys into the state and counts invocations."""

    def __init__(self, updates: dict):
        self.updates = updates
        self.calls = 0

    async def run(self, state: dict) -> dict:
        self.calls += 1
        state.update(self.updates)
        return state


class FakeCritic:
    """Pops one verdict per invocation from a queue of booleans."""

    def __init__(self, verdicts: list[bool]):
        self.verdicts = list(verdicts)
        self.calls = 0

    async def run(self, state: dict) -> dict:
        self.calls += 1
        approved = self.verdicts.pop(0)
        issues = [] if approved else [
            CriticIssue(exercise_order=1, issue_type="wrong_answer", detail="planted")
        ]
        state["critic_report"] = CriticReport(approved=approved, issues=issues)
        return state


class FakePackage:
    async def run(self, state: dict) -> dict:
        request = state["request"]
        state["package"] = CurriculumPackage(
            title="Fake package",
            subject=request.subject,
            grade_level=request.grade_level,
            difficulty_level=request.difficulty_level,
            weekly_sequence=state.get("sequence", []),
            lessons=state.get("lessons", sample_lessons()),
            assessment=state.get(
                "assessment",
                AssessmentBundle(rubric="r", diagnostics=[], exit_tickets=[]),
            ),
            critic_report=state["critic_report"],
            quality_scores=QualityScores(),
        )
        return state


class SlowStage:
    def __init__(self, delay_s: float):
        self.delay_s = delay_s

    async def run(self, state: dict) -> dict:
        await asyncio.sleep(self.delay_s)
        return state


def fake_agents(critic_verdicts: list[bool]) -> dict:
    return {
        "intake": FakeStage({"standards": [{"id": "MATH.5.1"}]}),
        "scope_sequence": FakeStage({"sequence": ["week 1", "week 2"]}),
        "lesson_design": FakeStage({"lessons": sample_lessons()}),
        "assessment_design": FakeStage(
            {"assessment": AssessmentBundle(rubric="3 levels", diagnostics=["q1"], exit_tickets=["e1"])}
        ),
        "critic": FakeCritic(critic_verdicts),
        "package": FakePackage(),
    }
