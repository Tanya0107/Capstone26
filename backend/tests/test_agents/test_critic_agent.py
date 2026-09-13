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


@pytest.mark.skip(reason="Implement in Phase 3, Step 3.3")
def test_wrong_answer_detected():
    ...


@pytest.mark.skip(reason="Implement in Phase 3, Step 3.3")
def test_hallucinated_step_detected():
    ...


@pytest.mark.skip(reason="Implement in Phase 3, Step 3.3")
def test_clean_unit_approved():
    ...
