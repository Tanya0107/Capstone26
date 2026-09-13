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


async def test_timeout_returns_504_body():
    """The app converts GenerationTimeoutError to a machine readable 504.

    The real generation route body lands in Step 3.6, so the handler is
    exercised through a temporary route that raises the typed error.
    """
    from httpx import ASGITransport, AsyncClient

    from app.main import app

    @app.post("/test/generation-timeout")
    async def raise_timeout():
        raise GenerationTimeoutError("budget exceeded")

    try:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            response = await client.post("/test/generation-timeout")
        assert response.status_code == 504
        assert response.json() == {"error": "generation_timeout", "retriable": True}
    finally:
        app.router.routes = [
            r for r in app.router.routes
            if getattr(r, "path", "") != "/test/generation-timeout"
        ]
