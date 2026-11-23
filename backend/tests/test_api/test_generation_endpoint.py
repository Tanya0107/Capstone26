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


@pytest.mark.skip(reason="Implement in Phase 3, Step 3.6")
def test_contract_happy_path():
    ...


@pytest.mark.skip(reason="Implement in Phase 3, Step 3.6")
def test_generation_timeout_504():
    ...
