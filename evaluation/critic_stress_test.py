"""FR3 stress test: measure Critic detection accuracy on planted flaws.

Build N mutated copies of gold standard exercises, per subject type (D8).
Quantitative: wrong final answers (off by one, sign flips, magnitude errors)
and hallucinated solution steps (invalid algebraic moves).
Open ended: planted factual errors and unsupported claims in model answers.
Both: ambiguous prompts.
Run each through the Critic and report precision, recall and F1 per flaw
type into evaluation/results/critic_stress.json.
"""

if __name__ == "__main__":
    raise SystemExit("TODO Phase 5, Step 5.4")
