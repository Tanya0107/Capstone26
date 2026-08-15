"""LLM provider abstraction.

One thin seam over both vendors. Per docs/DECISIONS.md D1, the generator and
tutor run on Anthropic (claude-sonnet-4-6) and the critic runs on OpenAI
(gpt-4o) so verification is independent across model families. Embeddings use
text-embedding-3-large (D2), which handles Hebrew content well.

The orchestrator passes timeout_s from the remaining NFR2 budget. Retries use
exponential backoff with at most 2 retries. Unit tests wrap FakeChatModel,
never the network (R7).
"""
from __future__ import annotations

import asyncio
import math
from typing import AsyncIterator, Optional, Protocol

from app.config import get_settings

JSON_ONLY_INSTRUCTION = (
    "Respond with a single valid JSON object only, no prose, no code fences."
)


class LLMError(Exception):
    """Base class for LLM layer errors."""


class LLMCallError(LLMError):
    """Provider call failed after exhausting retries."""


class LLMTimeoutError(LLMError):
    """The call exceeded the remaining NFR2 budget."""


class ChatModel(Protocol):
    async def complete(
        self,
        system: str,
        messages: list[dict],
        *,
        json_mode: bool = False,
        timeout_s: Optional[float] = None,
    ) -> str: ...

    def stream(self, system: str, messages: list[dict]) -> AsyncIterator[str]: ...


class ResilientChatModel:
    """Retry and timeout wrapper around any inner chat model.

    The inner model only needs complete(system, messages, json_mode=...) and
    stream(system, messages), which is exactly the FakeChatModel surface, so
    tests wrap the fake and never touch the network.
    """

    def __init__(self, inner, *, max_retries: int = 2, backoff_base_s: float = 0.5):
        self.inner = inner
        self.max_retries = max_retries
        self.backoff_base_s = backoff_base_s

    async def complete(
        self,
        system: str,
        messages: list[dict],
        *,
        json_mode: bool = False,
        timeout_s: Optional[float] = None,
    ) -> str:
        try:
            return await asyncio.wait_for(
                self._complete_with_retries(system, messages, json_mode=json_mode),
                timeout=timeout_s,
            )
        except (asyncio.TimeoutError, TimeoutError) as exc:
            raise LLMTimeoutError(
                f"LLM call exceeded the remaining budget of {timeout_s}s"
            ) from exc

    async def _complete_with_retries(
        self, system: str, messages: list[dict], *, json_mode: bool
    ) -> str:
        last_error: Optional[Exception] = None
        for attempt in range(self.max_retries + 1):
            try:
                return await self.inner.complete(system, messages, json_mode=json_mode)
            except Exception as exc:
                last_error = exc
                if attempt < self.max_retries:
                    await asyncio.sleep(self.backoff_base_s * (2 ** attempt))
        raise LLMCallError(
            f"LLM call failed after {self.max_retries + 1} attempts"
        ) from last_error

    async def stream(self, system: str, messages: list[dict]) -> AsyncIterator[str]:
        async for token in self.inner.stream(system, messages):
            yield token


class LangChainChatModel:
    """Adapter from the ChatModel protocol to a LangChain chat model."""

    def __init__(self, chat, json_bind_kwargs: Optional[dict] = None):
        self.chat = chat
        self.json_bind_kwargs = json_bind_kwargs or {}
        self.last_usage: Optional[dict] = None

    @staticmethod
    def _to_langchain_messages(system: str, messages: list[dict]) -> list[tuple]:
        rendered = [("system", system)]
        for message in messages:
            rendered.append((message["role"], message["content"]))
        return rendered

    @staticmethod
    def _content_to_text(content) -> str:
        if isinstance(content, str):
            return content
        parts = []
        for block in content:
            if isinstance(block, str):
                parts.append(block)
            elif isinstance(block, dict) and block.get("type") == "text":
                parts.append(block.get("text", ""))
        return "".join(parts)

    async def complete(
        self, system: str, messages: list[dict], *, json_mode: bool = False
    ) -> str:
        chat = self.chat
        if json_mode:
            system = f"{system}\n\n{JSON_ONLY_INSTRUCTION}"
            if self.json_bind_kwargs:
                chat = chat.bind(**self.json_bind_kwargs)
        response = await chat.ainvoke(self._to_langchain_messages(system, messages))
        self.last_usage = getattr(response, "usage_metadata", None)
        return self._content_to_text(response.content)

    async def stream(self, system: str, messages: list[dict]) -> AsyncIterator[str]:
        async for chunk in self.chat.astream(
            self._to_langchain_messages(system, messages)
        ):
            text = self._content_to_text(chunk.content)
            if text:
                yield text


ROLE_TO_SETTING = {
    "generator": "generator_model",
    "critic": "critic_model",
    "tutor": "tutor_model",
    "tutor_fallback": "tutor_fallback_model",
}


def get_chat_model(role: str) -> ResilientChatModel:
    """Return the configured resilient model for a pipeline role.

    role is one of generator, critic, tutor, tutor_fallback. All generation
    prompts must instruct Hebrew output (D5), that lives in the prompt files.
    """
    settings = get_settings()
    if role not in ROLE_TO_SETTING:
        raise ValueError(f"Unknown model role: {role}")
    model_name = getattr(settings, ROLE_TO_SETTING[role])

    if model_name.startswith("claude"):
        from langchain_anthropic import ChatAnthropic

        # Empty key falls through to call time auth errors, which keeps
        # unit tests free of env requirements
        chat = ChatAnthropic(
            model=model_name,
            api_key=settings.anthropic_api_key or "not-set",
            max_tokens=16000,
            max_retries=0,
            timeout=60,
        )
        json_bind_kwargs = None
    else:
        from langchain_openai import ChatOpenAI

        chat = ChatOpenAI(
            model=model_name,
            api_key=settings.openai_api_key or "not-set",
            max_retries=0,
            timeout=60,
        )
        json_bind_kwargs = {"response_format": {"type": "json_object"}}

    return ResilientChatModel(LangChainChatModel(chat, json_bind_kwargs))


def l2_normalize(vectors: list[list[float]]) -> list[list[float]]:
    """Normalize so cosine similarity equals dot product."""
    normalized = []
    for vector in vectors:
        norm = math.sqrt(sum(value * value for value in vector)) or 1.0
        normalized.append([value / norm for value in vector])
    return normalized


EMBED_BATCH_SIZE = 128


async def embed(texts: list[str]) -> list[list[float]]:
    """Embedding call for the Feedback Memory Bank (FR6) and RAG retrieval.

    Batches requests and L2 normalizes the result (D2).
    """
    settings = get_settings()
    from openai import AsyncOpenAI

    client = AsyncOpenAI(api_key=settings.openai_api_key)
    vectors: list[list[float]] = []
    for start in range(0, len(texts), EMBED_BATCH_SIZE):
        batch = texts[start : start + EMBED_BATCH_SIZE]
        response = await client.embeddings.create(
            model=settings.embedding_model, input=batch
        )
        vectors.extend(item.embedding for item in response.data)
    return l2_normalize(vectors)
