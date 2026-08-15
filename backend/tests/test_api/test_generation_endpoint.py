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


@pytest.mark.skip(reason="Implement in Phase 2/3")
def test_contract_happy_path():
    ...
