"""Critic Agent unit tests (Phase 3 acceptance gate for FR3).

Cases to implement:
  1. Wrong-answer detection: generator says 12, independent solve says 15
     -> issue_type == "wrong_answer", approved == False.
  2. Hallucinated-step detection on a planted invalid algebra step.
  3. Clean unit -> approved == True, zero issues.
  4. Orchestrator loop: 2 rejections then approval -> regeneration_cycles_used == 2.
  5. Loop cap: never exceeds settings.max_critic_regeneration_cycles.
"""
import pytest


@pytest.mark.skip(reason="Implement in Phase 3, Step 3.3")
def test_wrong_answer_detected():
    ...
