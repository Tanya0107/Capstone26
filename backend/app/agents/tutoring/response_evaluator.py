"""Response Evaluator — classifies each student attempt.

Categories: correct / partially-correct / misconception-X / off-task.
Off-task detection feeds constructive-redirection behavior (Liu et al., 2025):
passive or off-topic chat should trigger a redirect, not a hint.
"""


async def check(student_message: str, exercise: dict) -> dict:
    raise NotImplementedError("Phase 3, Step 3.5")
