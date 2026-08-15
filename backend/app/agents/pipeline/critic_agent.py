"""Stage 5. Equity and Quality Review Agent (the Critic). FR3.

The heart of Agentic Self Correction. Verification strategy is subject aware
(D8):

Quantitative subjects (math, physics and similar)
  1. Independently re-solve every exercise without seeing the generator
     answer, using a different model family (settings.critic_model).
  2. Compare with normalization (numeric tolerance, fraction and decimal
     equivalence, algebraic form).
  3. Flag wrong_answer and hallucinated_step.

Open ended subjects (history, literature, science explanations)
  1. Extract factual claims from prompts, model answers and hints.
  2. Verify each claim independently and flag factual_error and
     unsupported_claim.
  3. Audit the model answer acceptance criteria for consistency with the
     prompt.

Both modes additionally audit taxonomy coverage (Bloom), ambiguity, equity
and readability. Output is a CriticReport. approved False routes the graph
back to lesson design.

Phase B stress test (evaluation/critic_stress_test.py) plants flaws of both
kinds and measures detection accuracy per subject type.
"""
from app.agents.base import BaseAgent


class CriticAgent(BaseAgent):
    name = "critic"
    prompt_file = "critic.md"
    model_role = "critic"

    async def run(self, state: dict) -> dict:
        raise NotImplementedError("Phase 3, Step 3.3, implement both verification modes")
