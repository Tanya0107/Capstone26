"""Manual LLM smoke test (Step 3.1 acceptance). Not part of CI.

Gets one real completion per provider and one real embedding, printing
token usage and approximate cost. Requires ANTHROPIC_API_KEY and
OPENAI_API_KEY in backend/.env.

Run from backend/:
    .venv/bin/python -m scripts.smoke_llm
"""
from __future__ import annotations

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.config import get_settings
from app.core.llm import embed, get_chat_model

# Approximate list prices per million tokens, recorded 2026-08 for the
# cost printout only. Real evaluation cost reporting happens in Phase 5.
PRICES_PER_MTOK = {
    "claude-sonnet-4-6": (3.00, 15.00),
    "gpt-4o": (2.50, 10.00),
    "text-embedding-3-large": (0.13, 0.0),
}


def report_cost(model_name: str, usage: dict | None) -> None:
    if not usage:
        print("  usage metadata unavailable")
        return
    input_tokens = usage.get("input_tokens", 0)
    output_tokens = usage.get("output_tokens", 0)
    print(f"  input tokens: {input_tokens}, output tokens: {output_tokens}")
    if model_name in PRICES_PER_MTOK:
        in_price, out_price = PRICES_PER_MTOK[model_name]
        cost = input_tokens / 1e6 * in_price + output_tokens / 1e6 * out_price
        print(f"  approximate cost: ${cost:.6f}")


async def main() -> None:
    settings = get_settings()
    if not settings.anthropic_api_key or not settings.openai_api_key:
        sys.exit("Set ANTHROPIC_API_KEY and OPENAI_API_KEY in backend/.env first")

    prompt = [{"role": "user", "content": "כתוב משפט קצר על שברים לתלמידי כיתה ה."}]

    print(f"Generator ({settings.generator_model}):")
    generator = get_chat_model("generator")
    text = await generator.complete(
        "You are a helpful teaching assistant. Answer in Hebrew.", prompt, timeout_s=30
    )
    print(f"  {text.strip()[:200]}")
    report_cost(settings.generator_model, generator.inner.last_usage)

    print(f"Critic ({settings.critic_model}):")
    critic = get_chat_model("critic")
    verdict = await critic.complete(
        "You verify math answers. Answer in JSON with keys approved and reason.",
        [{"role": "user", "content": "Is 1/2 + 1/4 = 3/4 correct?"}],
        json_mode=True,
        timeout_s=30,
    )
    print(f"  {verdict.strip()[:200]}")
    report_cost(settings.critic_model, critic.inner.last_usage)

    print(f"Embedding ({settings.embedding_model}):")
    vectors = await embed(["חצי ועוד רבע שווה שלושה רבעים"])
    norm = sum(v * v for v in vectors[0]) ** 0.5
    print(f"  dimensions: {len(vectors[0])}, L2 norm: {norm:.4f}")
    print("  cost is a fraction of a cent for one short text")

    print("\nSmoke test passed.")


if __name__ == "__main__":
    asyncio.run(main())
