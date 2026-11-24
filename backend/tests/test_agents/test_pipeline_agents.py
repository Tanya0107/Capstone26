"""Pipeline agent unit tests with canned fake outputs (Step 3.3, R7).

Covers the shared validation retry pattern (valid plus invalid JSON cases)
and representative per agent behavior. Critic cases 1 to 3 live in
test_critic_agent.py.
"""
import json

import pytest

from app.agents.base import AgentOutputError
from app.agents.pipeline.answer_compare import answers_equivalent
from app.agents.pipeline.intake_agent import IntakeAgent
from app.agents.pipeline.lesson_design_agent import LessonDesignAgent
from app.agents.pipeline.scope_sequence_agent import ScopeSequenceAgent
from app.agents.standards.loader import UnknownSubjectError, load_standards
from app.core.llm import ResilientChatModel
from tests.conftest import FakeChatModel


def resilient(responses: list[str]) -> ResilientChatModel:
    return ResilientChatModel(FakeChatModel(responses), backoff_base_s=0.001)


VALID_INTAKE = json.dumps({
    "standards": [
        {"id": "IL-MOE-MATH-G5-NUM-01", "text_he": "שברים", "rationale_he": "מתאים"}
    ],
    "development_targets_he": ["חשיבה כמותית"],
})

INVALID_ID_INTAKE = json.dumps({
    "standards": [{"id": "MADE-UP-ID", "text_he": "x", "rationale_he": "y"}],
    "development_targets_he": [],
})


async def test_intake_happy_path(sample_request):
    agent = IntakeAgent(model=resilient([VALID_INTAKE]))
    state = await agent.run({"request": sample_request, "rag_context": []})
    assert state["standards"][0]["id"] == "IL-MOE-MATH-G5-NUM-01"
    assert state["development_targets"] == ["חשיבה כמותית"]


async def test_intake_retries_on_invalid_id_then_succeeds(sample_request):
    """The validation retry pattern: invalid output, error appended, retry."""
    agent = IntakeAgent(model=resilient([INVALID_ID_INTAKE, VALID_INTAKE]))
    state = await agent.run({"request": sample_request, "rag_context": []})
    assert state["standards"][0]["id"] == "IL-MOE-MATH-G5-NUM-01"


async def test_intake_raises_after_two_invalid_outputs(sample_request):
    agent = IntakeAgent(model=resilient([INVALID_ID_INTAKE, "not json at all"]))
    with pytest.raises(AgentOutputError):
        await agent.run({"request": sample_request, "rag_context": []})


async def test_json_with_leading_prose_parses_without_retry(sample_request):
    """A chatty preamble around the JSON object must not cost a retry. The
    fake holds one response, so a retry would exhaust it and fail."""
    wrapped = "הנה הפלט המבוקש:\n" + VALID_INTAKE + "\nבהצלחה"
    agent = IntakeAgent(model=resilient([wrapped]))
    state = await agent.run({"request": sample_request, "rag_context": []})
    assert state["standards"][0]["id"] == "IL-MOE-MATH-G5-NUM-01"


async def test_intake_unknown_subject_raises(sample_request):
    request = sample_request.model_copy(update={"subject": "astrology"})
    agent = IntakeAgent(model=resilient([]))
    with pytest.raises(UnknownSubjectError):
        await agent.run({"request": request, "rag_context": []})


def test_standards_loader_grade_slice():
    grade5 = load_standards("math", "5")
    assert grade5, "grade 5 math slice must not be empty"
    assert all(entry["grade"] == "5" for entry in grade5)
    cross_grade = load_standards("history", "8")
    ids = {entry["id"] for entry in cross_grade}
    # The historical thinking skill entry is cross grade via grade_note
    assert "IL-MOE-HIST-G6-SKL-01" in ids


async def test_scope_sequence_formats_weeks(sample_request):
    output = json.dumps({
        "weeks": [
            {"week": 2, "focus": "העמקה", "topics": ["שברים"], "flex": True},
            {"week": 1, "focus": "יסודות", "topics": ["מבוא"], "flex": False},
        ]
    })
    agent = ScopeSequenceAgent(model=resilient([output]))
    state = await agent.run({"request": sample_request})
    assert state["sequence"] == ["שבוע 1: יסודות", "שבוע 2: העמקה (זמן גמיש)"]


LESSONS_JSON = json.dumps({
    "lessons": [
        {
            "title": "חצי של חצי",
            "objectives": ["הבנת שברי יחידה"],
            "hook": "מתכון לשניים הופך למתכון לאחד",
            "exercises": [
                {
                    "order": 1,
                    "prompt": "כמה זה חצי של חצי?",
                    "correctAnswer": "1/4",
                    "scaffoldSteps": ["ציירו עיגול"],
                    "socraticHints": [{"hintOrder": 1, "hintText": "מה ידוע לנו?"}],
                }
            ],
        }
    ]
})

DUPLICATE_ORDER_LESSONS = json.dumps({
    "lessons": [
        {
            "title": "a", "objectives": ["x"], "hook": "h",
            "exercises": [
                {"order": 1, "prompt": "p1", "correctAnswer": "1"},
                {"order": 1, "prompt": "p2", "correctAnswer": "2"},
            ],
        }
    ]
})


async def test_lesson_design_parses_camel_case(sample_request):
    agent = LessonDesignAgent(model=resilient([LESSONS_JSON]))
    state = await agent.run({"request": sample_request})
    lesson = state["lessons"][0]
    assert lesson.exercises[0].correct_answer == "1/4"
    assert lesson.exercises[0].socratic_hints[0].hint_text == "מה ידוע לנו?"


async def test_lesson_design_rejects_duplicate_orders_then_retries(sample_request):
    agent = LessonDesignAgent(model=resilient([DUPLICATE_ORDER_LESSONS, LESSONS_JSON]))
    state = await agent.run({"request": sample_request})
    assert len(state["lessons"][0].exercises) == 1


@pytest.mark.parametrize(
    ("expected", "actual", "equal"),
    [
        ("3/4", "0.75", True),
        ("3/4", "6/8", True),
        ("15", "15.0000001", True),
        ("12", "15", False),
        ("50%", "1/2", True),
        ("2*x + 2", "2*(x + 1)", True),
        ("x**2 - 1", "(x-1)*(x+1)", True),
        ("x^2 - 1", "(x-1)*(x+1)", True),
        ("x + 1", "x + 2", False),
        ("3 × 4", "12", True),
        ("ירושלים", "ירושלים", True),
        ("ירושלים", "תל אביב", False),
        ("התשובה היא 3/4", "0.75", True),
        # Units and Hebrew text around the number on the stated side
        ("3/4 כוס קמח", "3/4", True),
        ("3/4 כוס", "0.75", True),
        ("12 עוגיות", "15", False),
        ("15 cm", "15", True),
        ("x = 5", "5", True),
        # A short justification must not hide a wrong final answer
        ("3/4, כי 1/2 + 1/4 = 3/4", "3/4", True),
        ("12, כי 3 × 4 = 12", "15", False),
        # Percent written as 20%, 20 or 0.2
        ("20%", "20", True),
        ("0.2", "20%", True),
        ("20", "0.2", False),
        # Mixed numbers, including the Hebrew conjunction form
        ("1 3/4", "7/4", True),
        ("1 ו-3/4", "1.75", True),
        # Notation variants
        ("1,000,000", "1000000", True),
        ("½", "0.5", True),
        ("\\frac{3}{4}", "0.75", True),
        ("−5", "-5", True),
        # Regressions from the 2026-09-13 dev runs
        ("1 וה-5/12", "1 5/12", True),
        ("4 וה-1/12", "4 1/12", True),
        ("1 וחמש שתים-עשרה (1 וה-5/12)", "1 5/12", True),
        ("המשקל שמדדתם גדול מהנדרש ב-0.05 כוסות", "0.05", True),
        ("200 × (1 − p²/10000)", "200(1 - (p/100)^2)", True),
        ("200(1-p^2/10000)", "200 × (1 − (p/100)²)", True),
        ("200 - 2p + p^2/100", "200 × (1 − (p/100)²)", False),
        ("62,100", "56,700", False),
        # A Hebrew prefix hyphen is not a minus sign, a real minus still counts
        ("ב-3", "-3", False),
        ("-5", "5", False),
        # Short categorical answers compare by words
        ("חנות A", "A", True),
        ("זוגי", "אי-זוגי", False),
        # Undecidable for the guard, the critic's pass 2 audit decides
        ("תהי המחיר M. חנות A: M × 0.80. חנות C: M × 0.828. לכן חנות A זולה יותר", "A", None),
        ("חמש שתים-עשרה", "5/12", None),
    ],
)
def test_answers_equivalent(expected, actual, equal):
    assert answers_equivalent(expected, actual) is equal


def test_sympy_path_refuses_unsafe_input():
    """parse_expr evaluates its input, model output must never reach it
    unless it is plain math."""
    from app.agents.pipeline import answer_compare

    assert answer_compare._sympy_equal("x.__class__", "x") is None
    assert answer_compare._sympy_equal("__import__('os')", "1") is None
    assert answers_equivalent("__import__('os').system('echo hi')", "5") is not True
