"""Critic Agent unit tests (Phase 3 acceptance gate for FR3).

Cases:
  1. Wrong-answer detection: generator says 12, independent solve says 15
     -> issue_type == "wrong_answer", approved == False.
  2. Hallucinated-step detection on a planted invalid algebra step.
  3. Clean unit -> approved == True, zero issues.
  4. Orchestrator loop: 2 rejections then approval -> regeneration_cycles_used == 2.
  5. Loop cap: never exceeds settings.max_critic_regeneration_cycles.

Cases 4 and 5 run the real orchestrator graph with all fake agents (Step
3.2). Cases 1 to 3 exercise the critic itself and land in Step 3.3.
"""
import pytest

from app.agents.orchestrator import run_pipeline
from app.config import get_settings
from tests.test_agents.fakes import fake_agents


async def test_two_rejections_then_approval_counts_cycles(sample_request):
    """Case 4: cycles counter reflects the number of regeneration passes."""
    agents = fake_agents(critic_verdicts=[False, False, True])
    package = await run_pipeline(sample_request, rag_context=[], agents=agents)
    assert package.critic_report.approved is True
    assert package.critic_report.regeneration_cycles_used == 2
    # First pass plus two regenerations
    assert agents["lesson_design"].calls == 3
    assert agents["critic"].calls == 3


async def test_loop_cap_surfaces_unapproved_package(sample_request):
    """Case 5: the loop stops at the cap and the rejection is surfaced."""
    settings = get_settings()
    max_cycles = settings.max_critic_regeneration_cycles
    agents = fake_agents(critic_verdicts=[False] * 10)
    package = await run_pipeline(sample_request, rag_context=[], agents=agents)
    assert package.critic_report.approved is False
    assert package.critic_report.regeneration_cycles_used == max_cycles
    assert package.critic_report.issues, "rejection issues must reach the teacher"
    assert agents["critic"].calls == max_cycles + 1


import json

from app.agents.pipeline.critic_agent import CriticAgent
from app.core.llm import ResilientChatModel
from app.core.schemas import Exercise, LessonUnit
from tests.conftest import FakeChatModel


def lessons_with_answer(answer: str) -> list[LessonUnit]:
    return [
        LessonUnit(
            title="שברים",
            objectives=["הבנה"],
            hook="פיצה",
            exercises=[
                Exercise(order=1, prompt="כמה זה 3 כפול 4?", correct_answer=answer)
            ],
        )
    ]


def critic_with(responses: list[str]) -> CriticAgent:
    return CriticAgent(model=ResilientChatModel(FakeChatModel(responses), backoff_base_s=0.001))


PASS1_SAYS_15 = json.dumps({"answers": [{"exercise_order": 1, "answer": "15", "steps": ["3*4=15"]}]})
PASS1_SAYS_12 = json.dumps({"answers": [{"exercise_order": 1, "answer": "12", "steps": ["3*4=12"]}]})
# Pass 1b, the Q11 confirmation re-solve, same shape as pass 1
RESOLVE_SAYS_15 = PASS1_SAYS_15
RESOLVE_SAYS_12 = PASS1_SAYS_12
CLEAN_REPORT = json.dumps({"approved": True, "issues": []})
HALLUCINATED_REPORT = json.dumps({
    "approved": False,
    "issues": [
        {"exerciseOrder": 1, "issueType": "hallucinated_step", "detail": "שלב אלגברי שגוי"}
    ],
})


async def test_wrong_answer_detected(sample_request):
    """Case 1: generator says 12, both blind solves say 15. The
    normalization guard flags it even though the model report was clean."""
    agent = critic_with([PASS1_SAYS_15, RESOLVE_SAYS_15, CLEAN_REPORT])
    state = {"request": sample_request, "lessons": lessons_with_answer("12")}
    state = await agent.run(state)
    report = state["critic_report"]
    assert report.approved is False
    assert report.issues[0].issue_type == "wrong_answer"


async def test_hallucinated_step_detected(sample_request):
    """Case 2: answers match but the model found an invalid step."""
    agent = critic_with([PASS1_SAYS_12, HALLUCINATED_REPORT])
    state = {"request": sample_request, "lessons": lessons_with_answer("12")}
    state = await agent.run(state)
    report = state["critic_report"]
    assert report.approved is False
    assert report.issues[0].issue_type == "hallucinated_step"


async def test_clean_unit_approved(sample_request):
    """Case 3: matching answers and a clean audit approve with zero issues."""
    agent = critic_with([PASS1_SAYS_12, CLEAN_REPORT])
    state = {"request": sample_request, "lessons": lessons_with_answer("12")}
    state = await agent.run(state)
    report = state["critic_report"]
    assert report.approved is True
    assert report.issues == []


async def test_open_ended_failed_claim_forces_rejection(sample_request):
    """Open ended mode: a false claim becomes factual_error via the guard."""
    request = sample_request.model_copy(update={"subject": "history"})
    pass1 = json.dumps({
        "claims": [
            {"exercise_order": 1, "claim": "טענה שגויה", "verdict": "false", "evidence": "מקור"}
        ]
    })
    agent = critic_with([pass1, CLEAN_REPORT])
    state = {"request": request, "lessons": lessons_with_answer("תשובת מודל")}
    state = await agent.run(state)
    report = state["critic_report"]
    assert report.approved is False
    assert report.issues[0].issue_type == "factual_error"


async def test_categorical_answer_defers_to_pass_two(sample_request):
    """Regression from the difficulty 5 dev run: a store label from the
    blind solve against a worked explanation must not force wrong_answer."""
    lessons = [
        LessonUnit(
            title="אחוזים",
            objectives=["השוואת מחירים"],
            hook="שלוש חנויות",
            exercises=[
                Exercise(
                    order=1,
                    prompt="איזו חנות זולה יותר, A או C?",
                    correct_answer="חנות A: M × 0.80. חנות C: M × 0.828. לכן חנות A זולה יותר.",
                )
            ],
        )
    ]
    pass1 = json.dumps({"answers": [{"exercise_order": 1, "answer": "A", "steps": []}]})
    agent = critic_with([pass1, CLEAN_REPORT])
    state = await agent.run({"request": sample_request, "lessons": lessons})
    assert state["critic_report"].approved is True
    assert state["critic_report"].issues == []


async def test_second_solve_rescues_a_correct_answer(sample_request):
    """Q11: the first blind solve was the wrong one. The confirmation
    re-solve agrees with the generator, so no wrong_answer is raised and a
    correct unit is not sent back round the regeneration loop."""
    agent = critic_with([PASS1_SAYS_15, RESOLVE_SAYS_12, CLEAN_REPORT])
    state = {"request": sample_request, "lessons": lessons_with_answer("12")}
    state = await agent.run(state)
    report = state["critic_report"]
    assert report.approved is True
    assert report.issues == []


async def test_matching_answers_skip_the_confirmation_call(sample_request):
    """Cost control: the extra solve runs only when answers disagree. The
    fake holds exactly two responses, so a third call would raise."""
    agent = critic_with([PASS1_SAYS_12, CLEAN_REPORT])
    state = {"request": sample_request, "lessons": lessons_with_answer("12")}
    state = await agent.run(state)
    assert state["critic_report"].approved is True


async def test_model_raised_wrong_answer_dropped_when_guard_agreed(sample_request):
    """Validation run finding: the critic's blind solve matched the stated
    answer, then pass 2 invented a divergence anyway. The deterministic
    comparison outranks that opinion, and a rejection whose only reason was
    dropped becomes an approval rather than an empty regeneration request."""
    invented = json.dumps({
        "approved": False,
        "issues": [
            {"exerciseOrder": 1, "issueType": "wrong_answer", "detail": "invented"}
        ],
    })
    agent = critic_with([PASS1_SAYS_12, invented])
    state = {"request": sample_request, "lessons": lessons_with_answer("12")}
    state = await agent.run(state)
    report = state["critic_report"]
    assert report.issues == []
    assert report.approved is True


async def test_model_raised_wrong_answer_kept_when_guard_disagreed(sample_request):
    """The drop rule is narrow: it only applies where the independent solve
    actually agreed. A real mismatch still rejects."""
    flagged = json.dumps({
        "approved": False,
        "issues": [
            {"exerciseOrder": 1, "issueType": "wrong_answer", "detail": "real"}
        ],
    })
    agent = critic_with([PASS1_SAYS_15, RESOLVE_SAYS_15, flagged])
    state = {"request": sample_request, "lessons": lessons_with_answer("12")}
    state = await agent.run(state)
    report = state["critic_report"]
    assert report.approved is False
    assert report.issues[0].issue_type == "wrong_answer"
