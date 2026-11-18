"""Inline FR4 scoring tests (Step 3.6, R7 so no model is ever loaded).

The regression that matters most is the tokenizer. The rouge_score default
strips every non Latin character, so Hebrew content would score a silent
0.0 forever and nobody would see a crash. test_default_tokenizer_would_
score_hebrew_zero pins that.
"""
import json
import sys

import pytest

from app.core.schemas import (
    AssessmentBundle,
    CriticReport,
    CurriculumPackage,
    Exercise,
    LessonUnit,
    QualityScores,
)
from app.evaluation import scoring

OBJECTIVES = [
    "התלמיד יזהה שברים במצבים יומיומיים ויסביר את משמעות המונה והמכנה",
    "התלמיד ייצג שבר נתון בשלושה ייצוגים שונים",
]
PROMPTS = ["במתכון כתוב שלושת רבעי כוס סוכר, ציירו כוס מדידה וסמנו את הכמות"]
SEQUENCE = ["שבוע 1: שברים בחיי היומיום", "שבוע 2: שברים שקולים והשוואה"]

UNRELATED_OBJECTIVES = [
    "התלמיד ישווה בין מסופוטמיה ומצרים העתיקה לפי מקורות ראשוניים",
    "התלמיד ינתח כתובת קדומה ויסביר את ההקשר ההיסטורי שלה",
]
UNRELATED_PROMPTS = ["קראו את חוקי חמורבי וכתבו מה הם מלמדים על החברה"]
UNRELATED_SEQUENCE = ["שבוע 1: ערי מסופוטמיה", "שבוע 2: שלטון ודת במצרים"]


def gold_unit(
    *,
    subject="math",
    grade="5",
    difficulty=3,
    validated=False,
    objectives=None,
    prompts=None,
    sequence=None,
) -> dict:
    """A reference unit in the gold_standard on disk shape."""
    meta = {
        "llm_involvement": "none",
        "validated_by": "רות כהן, מורה למתמטיקה" if validated else "TODO: teacher name and role",
        "validation_date": "2026-11-01" if validated else None,
        "status": "VALIDATED" if validated else "DRAFT, not valid for metric runs",
    }
    return {
        "reference_metadata": meta,
        "title": "יחידת ייחוס",
        "subject": subject,
        "grade_level": grade,
        "difficulty_level": difficulty,
        "weekly_sequence": list(SEQUENCE if sequence is None else sequence),
        "lessons": [
            {
                "title": "שיעור 1",
                "objectives": list(OBJECTIVES if objectives is None else objectives),
                "hook": "פתיחה",
                "exercises": [
                    {"order": 1, "prompt": prompt, "correct_answer": "3/4"}
                    for prompt in (PROMPTS if prompts is None else prompts)
                ],
            }
        ],
    }


def package(
    *,
    subject="math",
    grade="5",
    difficulty=3,
    objectives=None,
    prompts=None,
    sequence=None,
) -> CurriculumPackage:
    objectives = OBJECTIVES if objectives is None else objectives
    prompts = PROMPTS if prompts is None else prompts
    return CurriculumPackage(
        title="טיוטה",
        subject=subject,
        grade_level=grade,
        difficulty_level=difficulty,
        weekly_sequence=list(SEQUENCE if sequence is None else sequence),
        lessons=[
            LessonUnit(
                title="שיעור 1",
                objectives=list(objectives),
                hook="פתיחה",
                exercises=[
                    Exercise(order=i + 1, prompt=prompt, correct_answer="3/4")
                    for i, prompt in enumerate(prompts)
                ],
            )
        ],
        assessment=AssessmentBundle(rubric="ר", diagnostics=[], exit_tickets=[]),
        critic_report=CriticReport(approved=True),
        quality_scores=QualityScores(),
    )


@pytest.fixture
def corpus(tmp_path, monkeypatch):
    """Point the scorer at a throwaway gold corpus.

    Tests must not depend on the real gold_standard directory, which grows
    as units are authored and validated.
    """
    def write(name: str, unit: dict) -> None:
        (tmp_path / f"{name}.json").write_text(
            json.dumps(unit, ensure_ascii=False), encoding="utf-8"
        )

    monkeypatch.setattr(scoring, "GOLD_STANDARD_DIR", tmp_path)
    scoring.load_references.cache_clear()
    yield write
    scoring.load_references.cache_clear()


# ------------------------------------------------------- the tokenizer


def test_default_tokenizer_would_score_hebrew_zero():
    """Why TOKENIZER_ID exists. The library default drops Hebrew entirely,
    which looks like a real score of 0.0 rather than a bug."""
    from rouge_score.tokenize import tokenize

    assert tokenize(OBJECTIVES[0], None) == []
    assert len(scoring.HebrewWordTokenizer().tokenize(OBJECTIVES[0])) > 5


def test_tokenizer_keeps_digits_and_latin():
    tokens = scoring.HebrewWordTokenizer().tokenize("שבוע 1: fractions, ו-3/4")
    assert "1" in tokens and "fractions" in tokens and "3" in tokens


def test_tokenizer_id_is_pinned():
    """A different split produces different scores for the same text, so
    the id has to be bumped deliberately. This is the tripwire that makes
    someone notice."""
    assert scoring.TOKENIZER_ID == "hebrew_word_v1"


# ------------------------------------------------------- library parity

ROUGE_PAIRS = [
    (OBJECTIVES[0], OBJECTIVES[0]),
    (OBJECTIVES[0], OBJECTIVES[1]),
    (OBJECTIVES[0], UNRELATED_OBJECTIVES[0]),
    (PROMPTS[0], UNRELATED_PROMPTS[0]),
    (SEQUENCE[0], SEQUENCE[1]),
    ("שבוע 1: שברים", "שבוע 1: שברים שקולים"),
    ("the quick brown fox", "the quick fox"),
    ("", OBJECTIVES[0]),
    (OBJECTIVES[0], ""),
    ("אין כאן שום מילה משותפת", "טקסט אחר לגמרי"),
]


def test_matches_the_rouge_score_library():
    """The inline ROUGE-L must agree with rouge_score exactly.

    The library is deliberately kept off the request path, see
    rouge_l_fmeasure, so this is the test that stops the per draft
    diagnostic and the Phase 5 reported metric from drifting apart. It is
    the only test here that imports rouge_score, and therefore the only
    slow one, since that import pulls nltk, numpy and scipy.
    """
    from rouge_score.rouge_scorer import RougeScorer

    tokenizer = scoring.HebrewWordTokenizer()
    library = RougeScorer(["rougeL"], tokenizer=tokenizer)
    for reference, candidate in ROUGE_PAIRS:
        expected = library.score(reference, candidate)["rougeL"].fmeasure
        actual = scoring.rouge_l_fmeasure(
            tokenizer.tokenize(reference), tokenizer.tokenize(candidate)
        )
        assert actual == pytest.approx(expected, abs=1e-12), (reference, candidate)


def test_rouge_l_is_symmetric_in_the_fmeasure():
    """F1 weights precision and recall equally, so swapping the sides must
    not change the number. The pairing above relies on that."""
    tokenizer = scoring.HebrewWordTokenizer()
    left = tokenizer.tokenize(OBJECTIVES[0])
    right = tokenizer.tokenize(OBJECTIVES[1])
    assert scoring.rouge_l_fmeasure(left, right) == pytest.approx(
        scoring.rouge_l_fmeasure(right, left)
    )


def test_rouge_l_handles_empty_sides():
    assert scoring.rouge_l_fmeasure([], ["א"]) == 0.0
    assert scoring.rouge_l_fmeasure(["א"], []) == 0.0
    assert scoring.rouge_l_fmeasure([], []) == 0.0


# ------------------------------------------------------- reference choice


def test_no_same_subject_reference_means_no_score(corpus):
    """A history draft is never scored against a math unit."""
    corpus("unit_math", gold_unit(subject="math"))
    scores = scoring.score_package(package(subject="history", grade="6"))
    assert scores.rouge_l is None
    assert scores.reference_unit is None
    assert scores.reference_validated is None


def test_nearest_reference_prefers_same_grade(corpus):
    corpus("unit_g3", gold_unit(grade="3"))
    corpus("unit_g5", gold_unit(grade="5"))
    chosen = scoring.nearest_reference(package(grade="5"))
    assert chosen.unit_id == "unit_g5"


def test_reference_choice_is_deterministic(corpus):
    """Two equally close references must not pick differently per process."""
    corpus("unit_b", gold_unit())
    corpus("unit_a", gold_unit())
    first = scoring.nearest_reference(package()).unit_id
    scoring.load_references.cache_clear()
    assert scoring.nearest_reference(package()).unit_id == first == "unit_a"


def test_template_and_brief_files_are_not_references(corpus):
    corpus("TEMPLATE_unit", gold_unit())
    corpus("brief_01", gold_unit())
    assert scoring.load_references() == ()


# ------------------------------------------------------- the score itself


def test_identical_draft_scores_one(corpus):
    corpus("unit_01", gold_unit())
    scores = scoring.score_package(package())
    assert scores.rouge_l == 1.0
    assert scores.reference_unit == "unit_01"


def test_unrelated_draft_scores_far_lower(corpus):
    """Similarity must actually discriminate, otherwise the number is
    decoration."""
    corpus("unit_01", gold_unit())
    same = scoring.score_package(package()).rouge_l
    other = scoring.score_package(
        package(
            objectives=UNRELATED_OBJECTIVES,
            prompts=UNRELATED_PROMPTS,
            sequence=UNRELATED_SEQUENCE,
        )
    ).rouge_l
    assert other is not None
    assert other < 0.3 < same


def test_padding_with_extra_objectives_lowers_the_score(corpus):
    """The reference side alone would ignore padding, which is why both
    directions are averaged."""
    corpus("unit_01", gold_unit())
    exact = scoring.score_package(package()).rouge_l
    padded = scoring.score_package(
        package(objectives=OBJECTIVES + UNRELATED_OBJECTIVES)
    ).rouge_l
    assert padded < exact


def test_only_shared_field_groups_are_scored(corpus):
    """A draft with no weekly sequence is scored on what it does have, not
    penalized with a zero for the missing group."""
    corpus("unit_01", gold_unit())
    with_sequence = scoring.score_package(package()).rouge_l
    without = scoring.score_package(package(sequence=[])).rouge_l
    assert with_sequence == without == 1.0


def test_draft_reference_is_flagged_unvalidated(corpus):
    """R1. A DRAFT reference may back this diagnostic but not a metric, so
    the flag has to reach the dashboard."""
    corpus("unit_01", gold_unit(validated=False))
    assert scoring.score_package(package()).reference_validated is False


def test_validated_reference_is_flagged(corpus):
    corpus("unit_01", gold_unit(validated=True))
    assert scoring.score_package(package()).reference_validated is True


def test_todo_placeholder_does_not_count_as_validation(corpus):
    """validated_by ships as a TODO string, which is truthy."""
    unit = gold_unit(validated=True)
    unit["reference_metadata"]["validated_by"] = "TODO: team member name"
    corpus("unit_01", unit)
    assert scoring.score_package(package()).reference_validated is False


def test_bleu_is_left_to_the_offline_harness(corpus):
    corpus("unit_01", gold_unit())
    assert scoring.score_package(package()).bleu is None


def test_bertscore_is_not_computed_inline(corpus):
    corpus("unit_01", gold_unit())
    assert scoring.score_package(package()).bertscore_f1 is None


# ------------------------------------------------------- never fail a draft


def test_empty_draft_does_not_raise(corpus):
    corpus("unit_01", gold_unit())
    empty = package(objectives=[], prompts=[], sequence=[])
    scores = scoring.score_package(empty)
    assert scores.rouge_l is None
    assert scores.reference_unit == "unit_01"


def test_unreadable_gold_file_is_skipped(corpus, tmp_path):
    corpus("unit_01", gold_unit())
    (tmp_path / "unit_broken.json").write_text("{not json", encoding="utf-8")
    scoring.load_references.cache_clear()
    assert [ref.unit_id for ref in scoring.load_references()] == ["unit_01"]


def test_scorer_failure_returns_the_draft_unscored(corpus, monkeypatch):
    corpus("unit_01", gold_unit())

    def boom(*args, **kwargs):
        raise RuntimeError("scorer exploded")

    monkeypatch.setattr(scoring, "_pairwise_best_mean", boom)
    scores = scoring.score_package(package())
    assert scores.rouge_l is None
    assert scores.reference_unit == "unit_01"


def test_real_gold_corpus_parses_and_selects():
    """Integration check against the committed corpus. No score assertion,
    because the corpus changes as units are authored."""
    scoring.load_references.cache_clear()
    references = scoring.load_references()
    assert references, "the committed gold_standard corpus should load"
    chosen = scoring.nearest_reference(package(subject="math", grade="5"))
    assert chosen is not None and chosen.subject == "math"
    scoring.load_references.cache_clear()


# ------------------------------------------------------- background BERTScore


def test_bertscore_returns_none_without_the_scorer(corpus, monkeypatch):
    """bert-score is deferred to Phase 5, so the absent branch is the live
    one and must stay silent rather than raise."""
    corpus("unit_01", gold_unit())
    monkeypatch.setitem(sys.modules, "bert_score", None)
    assert scoring.bertscore_f1(package()) is None


def test_bertscore_returns_none_without_a_reference(corpus):
    corpus("unit_math", gold_unit(subject="math"))
    assert scoring.bertscore_f1(package(subject="history")) is None


async def test_attach_bertscore_patches_the_module(monkeypatch):
    """The wiring, with the scorer stubbed. Only the inner bert_score call
    is unexercised, since the package is not installed."""
    patched = {}
    monkeypatch.setattr(scoring, "bertscore_f1", lambda pkg: 0.8123)
    monkeypatch.setattr(
        "app.core.firestore.patch_module_quality_scores",
        lambda key, scores: patched.update({"key": key, **scores}),
    )
    await scoring.attach_bertscore("m_1", package())
    assert patched == {"key": "m_1", "bertscoreF1": 0.8123}


async def test_attach_bertscore_skips_the_write_when_absent(monkeypatch):
    calls = []
    monkeypatch.setattr(scoring, "bertscore_f1", lambda pkg: None)
    monkeypatch.setattr(
        "app.core.firestore.patch_module_quality_scores",
        lambda key, scores: calls.append(key),
    )
    await scoring.attach_bertscore("m_1", package())
    assert calls == []


@pytest.mark.parametrize("failing", ["scorer", "write"])
async def test_attach_bertscore_never_raises(monkeypatch, failing):
    """It runs after the response, so an exception here would only produce
    an unhandled error in the server log for a draft already delivered."""
    def boom(*args, **kwargs):
        raise RuntimeError("boom")

    monkeypatch.setattr(
        scoring, "bertscore_f1", boom if failing == "scorer" else lambda pkg: 0.5
    )
    monkeypatch.setattr("app.core.firestore.patch_module_quality_scores", boom)
    await scoring.attach_bertscore("m_1", package())
