"""Post generation answer leak guard (FR11, R6).

The tutor must never hand a student the answer, however the student asks.
Prompt rules are not enough on their own, so every generated hint is
checked here before it leaves the server. The check is subject aware (D8):

  quantitative   the hint must not contain the answer's VALUE in any
                 notation, so it reuses the critic's normalizer and
                 recognises 1 5/12 as 17/12
  open ended     the hint must not reproduce the model answer, checked by
                 short answer containment, shared phrases and overall
                 similarity

Deliberate bias: a false positive costs one regeneration, a false negative
hands a child the answer. Where the two trade off, this flags. If an
exercise's answer value also appears in its own wording, hints about it
will be regenerated and may fall back to a metacognitive prompt, which is
the safe failure.
"""
from __future__ import annotations

import re
from difflib import SequenceMatcher

from app.agents.pipeline.answer_compare import numeric_values, values_overlap

# A short answer is one a hint could state outright, so containment alone
# is a leak. Longer model answers are judged on phrases and similarity.
SHORT_ANSWER_CHARS = 60
# A run of this many consecutive answer words inside a hint is a quotation,
# not a coincidence.
PHRASE_WORDS = 5
# Whole string similarity above this reads as a paraphrase of the answer.
SIMILARITY_THRESHOLD = 0.60

# Hebrew niqqud and bidi control marks carry no meaning for this comparison
DIACRITICS_RE = re.compile(r"[֑-ׇ‎‏‪-‮]")
PUNCT_RE = re.compile(r"[^\w\s/.\-]", re.UNICODE)
WS_RE = re.compile(r"\s+")

SAFEST_FALLBACK_HINT = (
    "בואו נעצור רגע ונחשוב יחד: מה בדיוק הבעיה מבקשת למצוא, "
    "ואיזה מידע כבר יש לכם כדי להתקדם?"
)


def normalize(text: str) -> str:
    text = DIACRITICS_RE.sub("", str(text))
    text = PUNCT_RE.sub(" ", text)
    return WS_RE.sub(" ", text).strip().casefold()


def _shares_phrase(hint_words: list[str], answer_words: list[str]) -> bool:
    if len(answer_words) < PHRASE_WORDS:
        return False
    hint_joined = " ".join(hint_words)
    for start in range(len(answer_words) - PHRASE_WORDS + 1):
        phrase = " ".join(answer_words[start : start + PHRASE_WORDS])
        if phrase in hint_joined:
            return True
    return False


def leaks_answer(hint: str, correct_answer: str, subject_type: str) -> bool:
    """True when the hint reveals the answer and must be regenerated."""
    hint_norm = normalize(hint)
    answer_norm = normalize(correct_answer)
    if not hint_norm or not answer_norm:
        return False

    # Stating a short answer outright, in either subject mode
    if len(answer_norm) <= SHORT_ANSWER_CHARS and answer_norm in hint_norm:
        return True

    if subject_type == "quantitative":
        answer_values = numeric_values(correct_answer)
        if not answer_values:
            # A non numeric answer in a quantitative subject still must not
            # be quoted, fall through to the text checks below
            pass
        elif values_overlap(numeric_values(hint), answer_values):
            return True

    hint_words = hint_norm.split()
    answer_words = answer_norm.split()
    if _shares_phrase(hint_words, answer_words):
        return True
    if SequenceMatcher(None, hint_norm, answer_norm).ratio() >= SIMILARITY_THRESHOLD:
        return True
    return False
