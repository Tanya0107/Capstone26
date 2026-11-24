"""POST /api/generation contract tests (pytest + httpx.AsyncClient).

Cases:
  1. Valid request + fully mocked pipeline -> 200, body validates as
     CurriculumPackage, latency field populated.
  2. Missing/invalid fields -> 422.
  3. Non-teacher token -> 403 (NFR4).
  4. Pipeline exceeds budget (mock slow stage) -> 504 with a body the
     frontend can use for graceful degradation (NFR7).
  5. JSON response schema snapshot, guards the frontend contract.

No real model or Firestore call happens here (R7): the pipeline, the
memory bank, the persist batch and the background scorer are all replaced.
The timeout case does run the real orchestrator, with a slow fake stage
and a 50ms budget, so the 504 comes from the actual budget enforcement
rather than a hand raised exception.
"""
import pytest
from httpx import ASGITransport, AsyncClient

from app.agents.orchestrator import run_pipeline as real_run_pipeline
from app.api import deps
from app.api.routes import generation as generation_route
from app.core.schemas import CurriculumPackage
from app.main import app
from tests.test_agents.fakes import SlowStage, fake_agents

VALID_PAYLOAD = {
    "teacherKey": "u_test",
    "schoolKey": "school1",
    "subject": "math",
    "goals": "Deepen fraction sense",
    "topics": ["fractions"],
    "gradeLevel": "5",
    "difficultyLevel": 3,
}


def override_role(role: str):
    async def fake_verify() -> dict:
        return {"uid": "u_test", "role": role}

    return fake_verify


async def test_non_teacher_forbidden():
    """Case 3: a student token must get 403 before the pipeline runs (NFR4)."""
    app.dependency_overrides[deps.verify_token] = override_role("student")
    try:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            response = await client.post("/api/generation", json=VALID_PAYLOAD)
        assert response.status_code == 403
    finally:
        app.dependency_overrides.clear()


async def test_missing_token_unauthorized():
    """No Authorization header -> 422 from the required header, treated as
    unauthorized access. With a malformed header the route returns 401."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        no_header = await client.post("/api/generation", json=VALID_PAYLOAD)
        bad_scheme = await client.post(
            "/api/generation",
            json=VALID_PAYLOAD,
            headers={"Authorization": "Basic nope"},
        )
    assert no_header.status_code in (401, 422)
    assert bad_scheme.status_code == 401


async def test_invalid_payload_422():
    """Case 2: schema violations are rejected before any pipeline work."""
    app.dependency_overrides[deps.verify_token] = override_role("teacher")
    try:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            missing_subject = {k: v for k, v in VALID_PAYLOAD.items() if k != "subject"}
            out_of_range = {**VALID_PAYLOAD, "difficultyLevel": 9}
            wrong_type = {**VALID_PAYLOAD, "topics": "not-a-list"}
            for payload in (missing_subject, out_of_range, wrong_type):
                response = await client.post("/api/generation", json=payload)
                assert response.status_code == 422, payload
    finally:
        app.dependency_overrides.clear()


def test_response_schema_snapshot():
    """Case 5: the served OpenAPI spec must match the frozen Phase 2 export.

    On intentional contract changes re-export docs/openapi.phase2.json,
    mirror models.ts and update docs/API_CONTRACT.md in the same commit (R5).
    """
    import json
    from pathlib import Path

    frozen_path = Path(__file__).resolve().parents[3] / "docs" / "openapi.phase2.json"
    frozen = json.loads(frozen_path.read_text())
    assert app.openapi() == frozen


@pytest.fixture
def teacher_client(monkeypatch):
    """Teacher auth with the pipeline, memory bank, persist and background
    scorer all stubbed out."""
    saved: dict = {}

    def fake_save(package, teacher_key):
        saved["package"] = package
        saved["teacher_key"] = teacher_key
        return "m_saved"

    scheduled: list = []

    async def fake_attach(module_key, package):
        scheduled.append(module_key)

    monkeypatch.setattr(
        generation_route.memory_bank, "retrieve_context", _no_context
    )
    monkeypatch.setattr(generation_route, "save_curriculum_package", fake_save)
    monkeypatch.setattr(generation_route, "attach_bertscore", fake_attach)
    app.dependency_overrides[deps.verify_token] = override_role("teacher")
    client = AsyncClient(transport=ASGITransport(app=app), base_url="http://test")
    yield client, saved, scheduled
    app.dependency_overrides.clear()


async def _no_context(request):
    return []


async def test_contract_happy_path(teacher_client, monkeypatch):
    """Case 1: the body validates, carries the new moduleKey, the measured
    latency and the inline FR4 scores."""
    client, saved, scheduled = teacher_client

    async def fake_pipeline(request, rag_context):
        return await real_run_pipeline(
            request, rag_context, agents=fake_agents(critic_verdicts=[True])
        )

    monkeypatch.setattr(generation_route, "run_pipeline", fake_pipeline)
    async with client:
        response = await client.post("/api/generation", json=VALID_PAYLOAD)

    assert response.status_code == 200
    body = response.json()
    package = CurriculumPackage.model_validate(body)
    assert package.module_key == "m_saved"
    assert package.generation_latency_seconds is not None
    assert body["qualityScores"]["referenceUnit"] is not None
    # The persisted draft is the same object the teacher received, scored
    assert saved["package"].quality_scores.rouge_l == package.quality_scores.rouge_l
    # creatorTeacherKey comes from the verified token, never from the body
    assert saved["teacher_key"] == "u_test"
    assert scheduled == ["m_saved"]


async def test_rag_context_reaches_the_pipeline(teacher_client, monkeypatch):
    """FR6. A retrieved memory is useless if the route drops it."""
    client, _, _ = teacher_client
    seen: dict = {}

    async def context(request):
        return ["העדפת עריכה קודמת של מורה"]

    async def fake_pipeline(request, rag_context):
        seen["context"] = rag_context
        return await real_run_pipeline(
            request, [], agents=fake_agents(critic_verdicts=[True])
        )

    monkeypatch.setattr(generation_route.memory_bank, "retrieve_context", context)
    monkeypatch.setattr(generation_route, "run_pipeline", fake_pipeline)
    async with client:
        await client.post("/api/generation", json=VALID_PAYLOAD)
    assert seen["context"] == ["העדפת עריכה קודמת של מורה"]


async def test_generation_timeout_504(teacher_client, monkeypatch):
    """Case 4: a stage that outlives the budget becomes the machine
    readable 504 the frontend keeps its form state on (NFR7)."""
    client, saved, scheduled = teacher_client

    async def slow_pipeline(request, rag_context):
        agents = fake_agents(critic_verdicts=[True])
        agents["lesson_design"] = SlowStage(delay_s=1.0)
        return await real_run_pipeline(
            request, rag_context, agents=agents, timeout_s=0.05
        )

    monkeypatch.setattr(generation_route, "run_pipeline", slow_pipeline)
    async with client:
        response = await client.post("/api/generation", json=VALID_PAYLOAD)

    assert response.status_code == 504
    assert response.json() == {"error": "generation_timeout", "retriable": True}
    # Nothing half written and no background work left behind
    assert saved == {} and scheduled == []


async def test_teacher_cannot_generate_for_another_teacher(teacher_client):
    """The module's creatorTeacherKey gates every later read, so a draft
    filed under someone else's key would be unreachable for its author and
    editable by the wrong teacher."""
    client, _, _ = teacher_client
    async with client:
        response = await client.post(
            "/api/generation", json={**VALID_PAYLOAD, "teacherKey": "someone_else"}
        )
    assert response.status_code == 403


@pytest.mark.parametrize("subject", ["art", "physics"])
async def test_unservable_subject_is_rejected_before_any_work(
    teacher_client, monkeypatch, subject
):
    """D8. art is in neither corpus, physics is classified for the critic
    but has no standards snapshot. Both must fail fast, not after minutes
    of model calls."""
    client, _, _ = teacher_client
    called = []

    async def fake_pipeline(request, rag_context):
        called.append(request.subject)
        raise AssertionError("the pipeline must not run")

    monkeypatch.setattr(generation_route, "run_pipeline", fake_pipeline)
    async with client:
        response = await client.post(
            "/api/generation", json={**VALID_PAYLOAD, "subject": subject}
        )
    assert response.status_code == 422
    assert called == []
