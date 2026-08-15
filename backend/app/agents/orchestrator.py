"""Orchestrator Agent (Fig 2/3) — central router for both pipelines.

Responsibilities:
  * Sequence the 6-stage curriculum pipeline as a LangGraph state machine.
  * Enforce the NFR2 budget: track elapsed time; pass remaining budget to each
    stage; on timeout return HTTP 504 semantics so the frontend can degrade
    gracefully (NFR7).
  * Run the FR3 self-correction loop: if the Critic rejects, route back to the
    Lesson/Assessment Design stages with the CriticIssues attached, at most
    settings.max_critic_regeneration_cycles times.
  * Inject RAG context from the Feedback Memory Bank into the intake state.

Sketch of the LangGraph graph (Phase 3, Step 3.2):

    intake -> scope_sequence -> lesson_design -> assessment_design -> critic
       ^                             |                                  |
       |            (issues, cycles < MAX) <----------------------------+
       |                                                                |
       +--- (approved) ----------------------------------> package  <--+
"""
from __future__ import annotations

from app.core.schemas import CurriculumPackage, GenerationRequest


async def run_pipeline(request: GenerationRequest, rag_context: list[str]) -> CurriculumPackage:
    """TODO Phase 3, Step 3.2:
      1. Build initial state {request, rag_context, started_at}.
      2. Compile & invoke the LangGraph graph with a hard asyncio timeout of
         settings.generation_timeout_seconds.
      3. Attach QualityScores from app.evaluation.scoring (FR4).
      4. Return a validated CurriculumPackage.
    """
    raise NotImplementedError
