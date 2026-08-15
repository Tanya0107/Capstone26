"""Feedback Memory Bank tests (FR6).

Cases:
  1. Identical draft/edit -> distance ~ 0 -> NOT stored.
  2. Substantive rewrite -> distance > threshold -> stored with vector.
  3. retrieve_context returns k most-similar memories, formatted for prompts.
"""
import pytest


@pytest.mark.skip(reason="Implement in Phase 3, Step 3.4")
def test_trivial_edit_not_stored():
    ...
