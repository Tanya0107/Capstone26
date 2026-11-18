"""FR4, inline algorithmic scoring attached to every generated draft.

Runs INSIDE the NFR2b budget, so it must be fast: the draft is compared
against the nearest gold standard reference unit with ROUGE-L, in pure
Python, with no model load on the request path.

Scored like with like, per evaluation/gold_standard/README.md:

    reference lessons[].objectives    vs  candidate lessons[].objectives
    reference exercises[].prompt      vs  candidate exercises[].prompt
    reference weekly_sequence         vs  candidate weekly_sequence

Never a whole package as one blob, and never across subjects: a history
draft scored against a math unit would produce a meaningless number, so a
draft with no same subject reference carries no similarity score at all.

Hebrew (D5, D6)
  * The rouge_score default tokenizer replaces every non Latin character
    with a space, so Hebrew tokenizes to nothing and every score would be
    a silent 0.0. A Hebrew preserving tokenizer is passed instead and
    named in TOKENIZER_ID, which test_scoring pins.
  * Known limitation: Hebrew prefix letters stay attached to their word,
    so בשברים and שברים are different tokens. Matches are therefore
    undercounted and the inline number is a conservative lower bound.
    Stemming is a Phase 5 question for compute_nlp_metrics.py, which owns
    the reported metric.
  * BERTScore needs xlm roberta large (D6) plus a torch install, far too
    slow for the request path, so it runs as a post response background
    task that patches the module doc. It is simply absent when the scorer
    is not installed, which is the current state, bert-score being
    deferred to Phase 5 by BUILD_GUIDE Step 0.1.
  * BLEU is left to the offline harness (Step 5.3) so the sacrebleu
    tokenization choice is made and recorded in exactly one place.

R1: every number here is a per draft diagnostic, the similarity of one
draft to one reference unit. It is not a Phase B result. A reference whose
reference_metadata is still DRAFT may back a diagnostic, flagged through
QualityScores.reference_validated, but may never back a reported metric.
That is the same split memory_bank.seed_cold_start applies to the cold
start exemplars.

Scoring never fails a generation. A package the scorer cannot read comes
back without scores, because a diagnostic is an enhancement and a teacher
would rather review an unscored draft than lose it.
"""
from __future__ import annotations

import asyncio
import json
import logging
import re
import statistics
from functools import lru_cache
from pathlib import Path
from typing import NamedTuple, Optional

from app.core.schemas import CurriculumPackage, QualityScores

logger = logging.getLogger(__name__)

GOLD_STANDARD_DIR = Path(__file__).resolve().parents[3] / "evaluation" / "gold_standard"

# Named in the scoring log line and pinned by test_scoring, so a change to
# how text is split cannot pass unnoticed. The offline harness records its
# own tokenizer in result metadata (compute_nlp_metrics.py requirement 2),
# where the number is a reported metric rather than a log line.
TOKENIZER_ID = "hebrew_word_v1"
BERTSCORE_MODEL = "xlm-roberta-large"  # D6, the package default is English only

# Bounds the per request work. Both sides are a handful of items at
# capstone scale, this only stops a pathological draft from pairing
# thousands of strings on the request path.
MAX_ITEMS_PER_GROUP = 60

WORD_RE = re.compile(r"\w+", re.UNICODE)
BIDI_MARKS_RE = re.compile(r"[‎‏‪-‮]")
# reference_metadata ships with TODO placeholders, which are truthy but
# mean unfilled
PLACEHOLDER_RE = re.compile(r"^\s*(todo|tbd)\b", re.IGNORECASE)

FIELD_GROUPS = ("objectives", "exercise_prompts", "weekly_sequence")


class HebrewWordTokenizer:
    """Whitespace and punctuation split that keeps every alphabet.

    rouge_score accepts any object exposing tokenize(text).
    """

    def tokenize(self, text: str) -> list[str]:
        cleaned = BIDI_MARKS_RE.sub("", str(text)).casefold()
        return WORD_RE.findall(cleaned)


TOKENIZER = HebrewWordTokenizer()


class GoldReference(NamedTuple):
    unit_id: str
    subject: str
    grade_level: str
    difficulty_level: Optional[int]
    validated: bool
    groups: dict[str, tuple[str, ...]]


def _filled(value: object) -> bool:
    """True when a reference_metadata field carries a real value."""
    text = str(value or "").strip()
    return bool(text) and not PLACEHOLDER_RE.match(text)


def _is_validated(unit: dict) -> bool:
    """A unit counts as validated only when a teacher signed it off and the
    status no longer says DRAFT (gold_standard/README.md)."""
    meta = unit.get("reference_metadata", {}) or {}
    status = str(meta.get("status", "")).strip().upper()
    return (
        _filled(meta.get("validated_by"))
        and _filled(meta.get("validation_date"))
        and not status.startswith("DRAFT")
    )


def _unit_groups(unit: dict) -> dict[str, tuple[str, ...]]:
    objectives: list[str] = []
    prompts: list[str] = []
    for lesson in unit.get("lessons", []) or []:
        objectives.extend(str(text) for text in lesson.get("objectives", []) or [])
        for exercise in lesson.get("exercises", []) or []:
            prompt = exercise.get("prompt")
            if prompt:
                prompts.append(str(prompt))
    sequence = [str(week) for week in unit.get("weekly_sequence", []) or []]
    return {
        "objectives": tuple(objectives),
        "exercise_prompts": tuple(prompts),
        "weekly_sequence": tuple(sequence),
    }


@lru_cache
def load_references() -> tuple[GoldReference, ...]:
    """Parse the gold standard corpus once per process.

    The corpus is a static repo artifact, so caching is safe. Tests that
    point GOLD_STANDARD_DIR elsewhere must call load_references.cache_clear.
    """
    if not GOLD_STANDARD_DIR.is_dir():
        logger.warning("No gold standard directory at %s", GOLD_STANDARD_DIR)
        return ()
    references: list[GoldReference] = []
    for path in sorted(GOLD_STANDARD_DIR.glob("*.json")):
        if path.name.startswith(("TEMPLATE", "brief_")):
            continue
        try:
            unit = json.loads(path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            logger.warning("Skipping unreadable gold unit %s", path.name)
            continue
        groups = _unit_groups(unit)
        if not any(groups.values()):
            continue
        difficulty = unit.get("difficulty_level")
        references.append(
            GoldReference(
                unit_id=path.stem,
                subject=str(unit.get("subject", "")),
                grade_level=str(unit.get("grade_level", "")),
                difficulty_level=difficulty if isinstance(difficulty, int) else None,
                validated=_is_validated(unit),
                groups=groups,
            )
        )
    return tuple(references)


def _grade_number(grade: str) -> Optional[int]:
    match = re.search(r"\d+", str(grade))
    return int(match.group()) if match else None


def _distance(left: Optional[int], right: Optional[int]) -> int:
    """Ordering key for reference choice. An unreadable value sorts last
    rather than pretending to be close."""
    if left is None or right is None:
        return 99
    return abs(left - right)


def nearest_reference(package: CurriculumPackage) -> Optional[GoldReference]:
    """The closest same subject reference, or None when there is none.

    Closest means same grade first, then nearest difficulty, then unit id
    so the choice is deterministic.
    """
    subject = str(package.subject).strip().casefold()
    candidates = [
        reference
        for reference in load_references()
        if reference.subject.strip().casefold() == subject
    ]
    if not candidates:
        return None
    package_grade = _grade_number(package.grade_level)
    return min(
        candidates,
        key=lambda reference: (
            _distance(_grade_number(reference.grade_level), package_grade),
            _distance(reference.difficulty_level, package.difficulty_level),
            reference.unit_id,
        ),
    )


def candidate_groups(package: CurriculumPackage) -> dict[str, tuple[str, ...]]:
    """The draft's scorable text, in the same shape as a reference."""
    objectives: list[str] = []
    prompts: list[str] = []
    for lesson in package.lessons:
        objectives.extend(lesson.objectives)
        prompts.extend(exercise.prompt for exercise in lesson.exercises)
    return {
        "objectives": tuple(objectives),
        "exercise_prompts": tuple(prompts),
        "weekly_sequence": tuple(package.weekly_sequence),
    }


def _lcs_length(reference: list[str], candidate: list[str]) -> int:
    """Longest common subsequence length over one rolling DP row."""
    previous = [0] * (len(candidate) + 1)
    for reference_token in reference:
        current = [0]
        for index, candidate_token in enumerate(candidate):
            if reference_token == candidate_token:
                current.append(previous[index] + 1)
            else:
                current.append(max(previous[index + 1], current[index]))
        previous = current
    return previous[-1]


def rouge_l_fmeasure(reference: list[str], candidate: list[str]) -> float:
    """ROUGE-L F1 over two token lists, the Lin 2004 definition.

    Reimplemented rather than called through rouge_score, which imports
    nltk and numpy at module level and drags scipy in behind them, all for
    a Porter stemmer this code never uses because it passes its own
    tokenizer. That import chain costs seconds on a warm filesystem cache
    and minutes on a cold one, which has no place inside a request the
    guide asks to keep cheap. The arithmetic is unambiguous, an LCS length
    over the two token lists, and test_scoring pins it against the library
    output so the inline diagnostic and the Phase 5 offline harness can
    never drift apart.
    """
    if not reference or not candidate:
        return 0.0
    lcs = _lcs_length(reference, candidate)
    if lcs == 0:
        return 0.0
    precision = lcs / len(candidate)
    recall = lcs / len(reference)
    return 2 * precision * recall / (precision + recall)


def _pairwise_best_mean(
    references: tuple[str, ...], candidates: tuple[str, ...]
) -> Optional[float]:
    """Order independent ROUGE-L between two lists of short texts.

    Lesson 2 of a draft need not correspond to lesson 2 of a reference, so
    each item is matched to its best counterpart rather than by position.
    Both directions are averaged: the reference side alone would reward a
    draft that covers every reference objective and adds ten unrelated
    ones, the candidate side alone would reward a draft that repeats one
    good objective.
    """
    references = references[:MAX_ITEMS_PER_GROUP]
    candidates = candidates[:MAX_ITEMS_PER_GROUP]
    if not references or not candidates:
        return None
    # Tokenized once per item rather than once per pair
    reference_tokens = [TOKENIZER.tokenize(text) for text in references]
    candidate_tokens = [TOKENIZER.tokenize(text) for text in candidates]
    matrix = [
        [rouge_l_fmeasure(reference, candidate) for candidate in candidate_tokens]
        for reference in reference_tokens
    ]
    reference_side = statistics.fmean(max(row) for row in matrix)
    candidate_side = statistics.fmean(
        max(row[index] for row in matrix) for index in range(len(candidates))
    )
    return (reference_side + candidate_side) / 2.0


def rouge_l_similarity(
    package: CurriculumPackage, reference: GoldReference
) -> tuple[Optional[float], list[str]]:
    """Mean ROUGE-L over the field groups both sides actually populate.

    Returns the score and the groups that contributed, so an empty result
    is distinguishable from a zero one.
    """
    candidate = candidate_groups(package)
    scores: list[float] = []
    scored: list[str] = []
    for group in FIELD_GROUPS:
        value = _pairwise_best_mean(reference.groups.get(group, ()), candidate[group])
        if value is None:
            continue
        scores.append(value)
        scored.append(group)
    if not scores:
        return None, []
    return round(statistics.fmean(scores), 4), scored


def score_package(package: CurriculumPackage) -> QualityScores:
    """Attach the inline FR4 diagnostic to one draft.

    bertscore_f1 stays empty here on purpose and is patched in later by
    attach_bertscore, bleu belongs to the offline harness. Any failure
    yields empty scores rather than an error, see the module docstring.
    """
    try:
        reference = nearest_reference(package)
    except Exception:
        logger.exception("Gold reference lookup failed, draft returned unscored")
        return QualityScores()

    if reference is None:
        logger.info(
            "No gold reference for subject %s, no similarity score attached",
            package.subject,
        )
        return QualityScores()

    try:
        rouge_l, scored_groups = rouge_l_similarity(package, reference)
    except Exception:
        logger.exception("Inline ROUGE-L failed, draft returned without a score")
        return QualityScores(
            reference_unit=reference.unit_id, reference_validated=reference.validated
        )

    if rouge_l is None:
        logger.info(
            "Reference %s and the draft share no comparable field group",
            reference.unit_id,
        )
    else:
        logger.info(
            "Inline ROUGE-L %.3f vs %s over %s (tokenizer %s)",
            rouge_l,
            reference.unit_id,
            ", ".join(scored_groups),
            TOKENIZER_ID,
        )
    return QualityScores(
        rouge_l=rouge_l,
        reference_unit=reference.unit_id,
        reference_validated=reference.validated,
    )


def bertscore_f1(package: CurriculumPackage) -> Optional[float]:
    """BERTScore F1 against the nearest reference, or None when it cannot
    be computed.

    Blocking and slow, both the model load and the forward pass, so it is
    only ever called off the request path through attach_bertscore.
    """
    reference = nearest_reference(package)
    if reference is None:
        return None
    try:
        from bert_score import BERTScorer
    except ImportError:
        logger.info(
            "bert-score is not installed (deferred to Phase 5 by BUILD_GUIDE "
            "Step 0.1), BERTScore omitted from the draft"
        )
        return None

    candidate = candidate_groups(package)
    scorer = BERTScorer(model_type=BERTSCORE_MODEL, lang="he", rescale_with_baseline=False)
    scores: list[float] = []
    for group in FIELD_GROUPS:
        references = list(reference.groups.get(group, ()))[:MAX_ITEMS_PER_GROUP]
        candidates = list(candidate[group])[:MAX_ITEMS_PER_GROUP]
        if not references or not candidates:
            continue
        # Multi reference scoring takes the best reference per candidate,
        # mirroring the ROUGE-L pairing so the two numbers are comparable
        forward = scorer.score(candidates, [references] * len(candidates))[2]
        backward = scorer.score(references, [candidates] * len(references))[2]
        scores.append((float(forward.mean()) + float(backward.mean())) / 2.0)
    if not scores:
        return None
    return round(statistics.fmean(scores), 4)


async def attach_bertscore(module_key: str, package: CurriculumPackage) -> None:
    """Post response BERTScore, patched onto the persisted module doc (D17).

    Scheduled as a FastAPI background task so it costs nothing against the
    NFR2b budget. Runs in a worker thread because the scorer is CPU bound
    and would otherwise block the event loop. Never raises: the teacher
    already has the draft, a missing diagnostic is not worth an error.
    """
    from app.core.firestore import patch_module_quality_scores

    try:
        value = await asyncio.to_thread(bertscore_f1, package)
    except Exception:
        logger.exception("Background BERTScore failed for module %s", module_key)
        return
    if value is None:
        return
    try:
        patch_module_quality_scores(module_key, {"bertscoreF1": value})
    except Exception:
        logger.exception("Could not patch BERTScore onto module %s", module_key)
        return
    logger.info("Patched BERTScore F1 %.3f onto module %s", value, module_key)
