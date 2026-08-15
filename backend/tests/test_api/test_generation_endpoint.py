"""POST /api/generation contract tests (pytest + httpx.AsyncClient).

Cases:
  1. Valid request + fully mocked pipeline -> 200, body validates as
     CurriculumPackage, latency field populated.
  2. Missing/invalid fields -> 422.
  3. Non-teacher token -> 403 (NFR4).
  4. Pipeline exceeds budget (mock slow stage) -> 504 with a body the
     frontend can use for graceful degradation (NFR7).
  5. JSON response schema snapshot — guards the frontend contract.
"""
import pytest
from httpx import ASGITransport, AsyncClient

from app.api import deps
from app.main import app

VALID_PAYLOAD = {
    "teacherKey": "t1",
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


@pytest.mark.skip(reason="Implement in Phase 2, Step 2.5")
def test_invalid_payload_422():
    ...


@pytest.mark.skip(reason="Implement in Phase 2, Step 2.5")
def test_response_schema_snapshot():
    ...


@pytest.mark.skip(reason="Implement in Phase 3, Step 3.6")
def test_contract_happy_path():
    ...


@pytest.mark.skip(reason="Implement in Phase 3, Step 3.6")
def test_generation_timeout_504():
    ...
