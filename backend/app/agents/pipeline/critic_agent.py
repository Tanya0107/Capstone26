"""Stage 5. Equity and Quality Review Agent (the Critic). FR3.

The heart of Agentic Self Correction. Verification strategy is subject
aware (D8):

Quantitative subjects (math, physics and similar)
  Pass 1: independently re-solve every exercise WITHOUT seeing the
  generator answer, on a different model family (settings.critic_model).
  Pass 2: compare and audit the full content.
  A deterministic normalization guard (answer_compare) then appends a
  wrong_answer issue for any numeric or algebraic mismatch the model
  failed to flag, so a polite critic can never wave a wrong answer
  through. A mismatch is re-solved blind a second time first and kept
  only if that solve also disagrees (Q11), because the critic's own
  solve can be the wrong one. Answers the guard cannot read reliably, such as a categorical
  label against a worked explanation, are left to the pass 2 audit.

Open ended subjects (history, literature, science explanations)
  Pass 1: extract factual claims from prompts, model answers and hints and
  verify each independently.
  Pass 2: audit acceptance criteria, taxonomy, ambiguity and equity.
  The guard appends factual_error and unsupported_claim issues for any
  failed claim the report missed.

Both modes: approval is enforced locally. Any wrong_answer,
hallucinated_step or factual_error forces approved False regardless of
what the model said. Output is a CriticReport. approved False routes the
graph back to lesson design.

Phase B stress test (evaluation/critic_stress_test.py) plants flaws of
both kinds and measures detection accuracy per subject type.
"""
import json
import logging
from typing import Literal

from pydantic import BaseModel, Field

from app.agents.base import BaseAgent
from app.agents.pipeline.answer_compare import answers_equivalent
from app.config import subject_type
from app.core.schemas import CriticIssue, CriticReport, Exercise

logger = logging.getLogger(__name__)

HARD_ISSUES = {"wrong_answer", "hallucinated_step", "factual_error"}


class IndependentAnswer(BaseModel):
    exercise_order: int
    answer: str
    steps: list[str] = Field(default_factory=list)


class Pass1Answers(BaseModel):
    answers: list[IndependentAnswer]


class VerifiedClaim(BaseModel):
    exercise_order: int
    claim: str
    verdict: Literal["supported", "unsupported", "false"]
    evidence: str = ""


class Pass1Claims(BaseModel):
    claims: list[VerifiedClaim]


class CriticAgent(BaseAgent):
    name = "critic"
    prompt_file = "critic.md"
    model_role = "critic"

    async def run(self, state: dict) -> dict:
        request = state["request"]
        stype = subject_type(request.subject)
        system = self.load_prompt(SUBJECT=request.subject, SUBJECT_TYPE=stype)
        exercises: list[Exercise] = [
            ex for lesson in state["lessons"] for ex in lesson.exercises
        ]

        if stype == "quantitative":
            report = await self._review_quantitative(system, state, exercises)
        else:
            report = await self._review_open_ended(system, state, exercises)

        # Local approval rule, never trust the model's own verdict alone
        if any(issue.issue_type in HARD_ISSUES for issue in report.issues):
            report.approved = False
        state["critic_report"] = report
        return state

    async def _review_quantitative(
        self, system: str, state: dict, exercises: list[Exercise]
    ) -> CriticReport:
        pass1_content = json.dumps(
            {
                "pass": 1,
                "instruction": "Solve each exercise independently. You are NOT shown the stated answers.",
                "exercises": [
                    {"exercise_order": ex.order, "prompt": ex.prompt} for ex in exercises
                ],
            },
            ensure_ascii=False,
        )
        pass1 = await self.call_json(
            system, pass1_content, state, Pass1Answers.model_validate
        )
        own_answers = {a.exercise_order: a for a in pass1.answers}

        mismatches: dict[int, tuple[str, str]] = {}
        for exercise in exercises:
            own = own_answers.get(exercise.order)
            # Only a decided mismatch counts, None defers to the pass 2 audit
            if own is not None and answers_equivalent(
                exercise.correct_answer, own.answer
            ) is False:
                mismatches[exercise.order] = (exercise.correct_answer, own.answer)

        if mismatches:
            mismatches = await self._confirm_mismatches(
                system, state, exercises, mismatches
            )

        pass2_content = json.dumps(
            {
                "pass": 2,
                "lessons": [
                    lesson.model_dump(by_alias=True) for lesson in state["lessons"]
                ],
                "your_independent_answers": [
                    a.model_dump() for a in pass1.answers
                ],
                "normalized_mismatches": [
                    {
                        "exercise_order": order,
                        "stated_answer": stated,
                        "your_answer": own,
                    }
                    for order, (stated, own) in mismatches.items()
                ],
            },
            ensure_ascii=False,
        )
        report = await self.call_json(
            system, pass2_content, state, CriticReport.model_validate
        )

        flagged = {
            (issue.exercise_order, issue.issue_type) for issue in report.issues
        }
        for order, (stated, own) in mismatches.items():
            if (order, "wrong_answer") not in flagged:
                report.issues.append(
                    CriticIssue(
                        exercise_order=order,
                        issue_type="wrong_answer",
                        detail=(
                            f"פתרון עצמאי נתן {own} בעוד התשובה הרשומה היא {stated}"
                        ),
                    )
                )
        return report

    async def _confirm_mismatches(
        self,
        system: str,
        state: dict,
        exercises: list[Exercise],
        mismatches: dict[int, tuple[str, str]],
    ) -> dict[int, tuple[str, str]]:
        """Re-solve only the disputed exercises, blind, and keep a mismatch
        only when the second solve also disagrees with the stated answer (Q11).

        A single blind solve can itself be wrong, which marked correct units
        unapproved in the dev runs. The stated answer is never shown here, so
        the second solve stays independent. Dropping a flag needs positive
        agreement, an undecidable comparison keeps it, so the guard never
        loses a real error in exchange for fewer false positives.
        """
        disputed = [ex for ex in exercises if ex.order in mismatches]
        content = json.dumps(
            {
                "pass": "1b",
                "instruction": (
                    "Re-solve these exercises independently and carefully, "
                    "step by step. You are NOT shown any stated answers."
                ),
                "exercises": [
                    {"exercise_order": ex.order, "prompt": ex.prompt}
                    for ex in disputed
                ],
            },
            ensure_ascii=False,
        )
        second = await self.call_json(
            system, content, state, Pass1Answers.model_validate
        )
        second_answers = {a.exercise_order: a.answer for a in second.answers}

        confirmed: dict[int, tuple[str, str]] = {}
        for order, (stated, first) in mismatches.items():
            again = second_answers.get(order)
            if again is not None and answers_equivalent(stated, again) is True:
                logger.info(
                    "Exercise %s: second blind solve agreed with the stated "
                    "answer, dropping the mismatch from the first solve (%s)",
                    order,
                    first,
                )
                continue
            confirmed[order] = (stated, first)
        return confirmed

    async def _review_open_ended(
        self, system: str, state: dict, exercises: list[Exercise]
    ) -> CriticReport:
        pass1_content = json.dumps(
            {
                "pass": 1,
                "instruction": "Extract every factual claim and verify each one independently.",
                "exercises": [
                    {
                        "exercise_order": ex.order,
                        "prompt": ex.prompt,
                        "model_answer": ex.correct_answer,
                        "hints": [hint.hint_text for hint in ex.socratic_hints],
                    }
                    for ex in exercises
                ],
            },
            ensure_ascii=False,
        )
        pass1 = await self.call_json(
            system, pass1_content, state, Pass1Claims.model_validate
        )
        failed_claims = [c for c in pass1.claims if c.verdict != "supported"]

        pass2_content = json.dumps(
            {
                "pass": 2,
                "lessons": [
                    lesson.model_dump(by_alias=True) for lesson in state["lessons"]
                ],
                "verified_claims": [c.model_dump() for c in pass1.claims],
            },
            ensure_ascii=False,
        )
        report = await self.call_json(
            system, pass2_content, state, CriticReport.model_validate
        )

        flagged = {
            (issue.exercise_order, issue.issue_type) for issue in report.issues
        }
        for claim in failed_claims:
            issue_type = (
                "factual_error" if claim.verdict == "false" else "unsupported_claim"
            )
            if (claim.exercise_order, issue_type) not in flagged:
                report.issues.append(
                    CriticIssue(
                        exercise_order=claim.exercise_order,
                        issue_type=issue_type,
                        detail=claim.claim,
                    )
                )
        return report
