"""Orchestrator Agent (Fig 2/3), central router for the curriculum pipeline.

Responsibilities:
  * Sequence the 6 stage curriculum pipeline as a LangGraph state machine.
  * Enforce the NFR2 budget with a hard asyncio timeout and expose the
    remaining budget so stages can pass it to core.llm.
  * Run the FR3 self correction loop: on critic rejection route back to
    lesson design with the CriticIssues attached, at most
    settings.max_critic_regeneration_cycles times. A rejection at the cap
    still produces a package with approved False surfaced to the teacher,
    never silently dropped.

Graph shape:

    intake -> scope_sequence -> lesson_design -> assessment_design -> critic
       ^                             |                                  |
       |            (issues, cycles < MAX) <----------------------------+
       |                                                                |
       +--- (approved or cap reached) ---------------------> package <--+
"""
from __future__ import annotations

import asyncio
import time
from typing import Any, Optional, TypedDict

from langgraph.graph import END, START, StateGraph

from app.config import get_settings
from app.core.schemas import (
    AssessmentBundle,
    CriticReport,
    CurriculumPackage,
    GenerationRequest,
    LessonUnit,
)


class GenerationTimeoutError(Exception):
    """The pipeline exceeded the NFR2 budget. The API layer converts this
    to a 504 with a machine readable body for NFR7 handling."""


class PipelineState(TypedDict, total=False):
    request: GenerationRequest
    rag_context: list[str]
    standards: list[dict]
    sequence: list[str]
    lessons: list[LessonUnit]
    assessment: AssessmentBundle
    critic_report: CriticReport
    package: CurriculumPackage
    started_at: float
    cycles: int


def remaining_budget(state: PipelineState) -> float:
    """Seconds left in the NFR2 budget, floored at zero. Stages pass this
    as timeout_s to core.llm calls."""
    settings = get_settings()
    elapsed = time.monotonic() - state["started_at"]
    return max(settings.generation_timeout_seconds - elapsed, 0.0)


def default_agents() -> dict[str, Any]:
    from app.agents.pipeline.assessment_design_agent import AssessmentDesignAgent
    from app.agents.pipeline.critic_agent import CriticAgent
    from app.agents.pipeline.intake_agent import IntakeAgent
    from app.agents.pipeline.lesson_design_agent import LessonDesignAgent
    from app.agents.pipeline.package_agent import PackageAgent
    from app.agents.pipeline.scope_sequence_agent import ScopeSequenceAgent

    return {
        "intake": IntakeAgent(),
        "scope_sequence": ScopeSequenceAgent(),
        "lesson_design": LessonDesignAgent(),
        "assessment_design": AssessmentDesignAgent(),
        "critic": CriticAgent(),
        "package": PackageAgent(),
    }


def build_graph(agents: Optional[dict[str, Any]] = None):
    """Compile the pipeline graph. agents is injectable so unit tests can
    run the loop logic with fakes and no network (R7)."""
    agents = agents or default_agents()
    settings = get_settings()

    async def intake_node(state: PipelineState) -> PipelineState:
        return await agents["intake"].run(state)

    async def scope_sequence_node(state: PipelineState) -> PipelineState:
        return await agents["scope_sequence"].run(state)

    async def lesson_design_node(state: PipelineState) -> PipelineState:
        report = state.get("critic_report")
        if report is not None and not report.approved:
            # This run is a regeneration pass driven by critic issues
            state["cycles"] = state.get("cycles", 0) + 1
        return await agents["lesson_design"].run(state)

    async def assessment_design_node(state: PipelineState) -> PipelineState:
        return await agents["assessment_design"].run(state)

    async def critic_node(state: PipelineState) -> PipelineState:
        state = await agents["critic"].run(state)
        state["critic_report"].regeneration_cycles_used = state.get("cycles", 0)
        return state

    async def package_node(state: PipelineState) -> PipelineState:
        return await agents["package"].run(state)

    def route_after_critic(state: PipelineState) -> str:
        if state["critic_report"].approved:
            return "package"
        if state.get("cycles", 0) < settings.max_critic_regeneration_cycles:
            return "lesson_design"
        # Cap reached, package anyway with approved False surfaced (FR3)
        return "package"

    graph = StateGraph(PipelineState)
    graph.add_node("intake", intake_node)
    graph.add_node("scope_sequence", scope_sequence_node)
    graph.add_node("lesson_design", lesson_design_node)
    graph.add_node("assessment_design", assessment_design_node)
    graph.add_node("critic", critic_node)
    graph.add_node("package", package_node)

    graph.add_edge(START, "intake")
    graph.add_edge("intake", "scope_sequence")
    graph.add_edge("scope_sequence", "lesson_design")
    graph.add_edge("lesson_design", "assessment_design")
    graph.add_edge("assessment_design", "critic")
    graph.add_conditional_edges(
        "critic",
        route_after_critic,
        {"package": "package", "lesson_design": "lesson_design"},
    )
    graph.add_edge("package", END)
    return graph.compile()


async def run_pipeline(
    request: GenerationRequest,
    rag_context: list[str],
    *,
    agents: Optional[dict[str, Any]] = None,
    timeout_s: Optional[float] = None,
) -> CurriculumPackage:
    """Run the 6 stage pipeline under the NFR2 budget and return a
    validated CurriculumPackage with latency populated."""
    settings = get_settings()
    budget = timeout_s if timeout_s is not None else settings.generation_timeout_seconds
    state: PipelineState = {
        "request": request,
        "rag_context": rag_context,
        "started_at": time.monotonic(),
        "cycles": 0,
    }
    compiled = build_graph(agents)
    try:
        final_state = await asyncio.wait_for(compiled.ainvoke(state), timeout=budget)
    except (asyncio.TimeoutError, TimeoutError) as exc:
        raise GenerationTimeoutError(
            f"Generation exceeded the {budget}s budget (NFR2)"
        ) from exc

    package = final_state["package"]
    package.generation_latency_seconds = round(
        time.monotonic() - state["started_at"], 3
    )
    return package
