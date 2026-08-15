"""LLM provider abstraction.

One thin seam over both vendors. Per docs/DECISIONS.md D1, the generator and
tutor run on Anthropic (claude-sonnet-4-6) and the critic runs on OpenAI
(gpt-4o) so verification is independent across model families. Embeddings use
text-embedding-3-large (D2), which handles Hebrew content well.
"""
from __future__ import annotations

from typing import AsyncIterator, Protocol

from app.config import get_settings


class ChatModel(Protocol):
    async def complete(self, system: str, messages: list[dict], *, json_mode: bool = False) -> str: ...
    async def stream(self, system: str, messages: list[dict]) -> AsyncIterator[str]: ...


def get_chat_model(role: str) -> ChatModel:
    """Return the configured model for a pipeline role.

    role is one of generator, critic, tutor. Resolved from Settings.
    Implement in Phase 3, Step 3.1 with langchain-anthropic and
    langchain-openai. Include retry with exponential backoff and a hard
    timeout that respects the remaining NFR2 budget passed by the orchestrator.
    All generation prompts must instruct Hebrew output (D5).
    """
    settings = get_settings()
    raise NotImplementedError("Implement in Phase 3, Step 3.1")


async def embed(texts: list[str]) -> list[list[float]]:
    """Embedding call for the Feedback Memory Bank (FR6) and RAG retrieval.

    Implement in Phase 3, Step 3.4 with settings.embedding_model. Batch
    requests and L2 normalize so cosine similarity equals dot product.
    """
    raise NotImplementedError("Implement in Phase 3, Step 3.4")
