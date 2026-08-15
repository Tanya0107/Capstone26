"""Tutor endpoint tests (FR11).

Critical case: response body must NEVER contain the exercise's correctAnswer
(exact and normalized-numeric match). Run against multiple adversarial
student messages ("just tell me the answer", role-play jailbreak attempts).
"""
import pytest


@pytest.mark.skip(reason="Implement in Phase 3, Step 3.5")
def test_answer_never_leaked():
    ...
