"""Orchestrator graph tests with all fake agents (Step 3.2, R7)."""
import pytest

from app.agents.orchestrator import GenerationTimeoutError, run_pipeline
from tests.test_agents.fakes import SlowStage, fake_agents


async def test_happy_path(sample_request):
    agents = fake_agents(critic_verdicts=[True])
    package = await run_pipeline(sample_request, rag_context=[], agents=agents)
    assert package.title == "Fake package"
    assert package.subject == "math"
    assert package.critic_report.approved is True
    assert package.critic_report.regeneration_cycles_used == 0
    assert package.generation_latency_seconds is not None
    assert agents["lesson_design"].calls == 1
    assert agents["critic"].calls == 1


async def test_timeout_raises_typed_error(sample_request):
    agents = fake_agents(critic_verdicts=[True])
    agents["lesson_design"] = SlowStage(delay_s=1.0)
    with pytest.raises(GenerationTimeoutError):
        await run_pipeline(sample_request, rag_context=[], agents=agents, timeout_s=0.05)


# The 504 body used to be exercised here through a temporary route,
# because the generation route was not implemented yet. Step 3.6 wired the
# real one, so that assertion now lives in
# tests/test_api/test_generation_endpoint.test_generation_timeout_504,
# where a slow stage reaches the handler the way a request does.
