"""Question Generator — graduated Socratic hint ladder.

Levels (calibrated in Phase 3):
  1. Metacognitive nudge      ("What is the problem really asking?")
  2. Concept pointer          ("Which property of triangles could relate these sides?")
  3. Strategy scaffold        ("Try writing the relationship as an equation first.")
  4. Worked sub-step          (one concrete step, never the final answer)

Level selection = f(hint history, HSR, affective state). Prefer pre-authored
exercise socraticHints when they exist; generate dynamically otherwise.
"""


async def next_hint(state: dict) -> dict:
    raise NotImplementedError("Phase 3, Step 3.5")
