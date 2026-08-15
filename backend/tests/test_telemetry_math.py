"""Pure-math tests for core.telemetry — implement FIRST (no mocks needed)."""
from app.core.telemetry import compute_ngs


def test_ngs_hake_formula():
    assert abs(compute_ngs(40, 70) - 0.5) < 1e-9


def test_ngs_perfect_pretest_guard():
    assert compute_ngs(100, 100) == 0.0
