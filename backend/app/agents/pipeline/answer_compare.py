"""Answer normalization for the critic's quantitative comparison (FR3).

Compares the generator's stated answer against the critic's independent
solve. Handles numeric tolerance, fraction, decimal, percent and mixed
number equivalence, LaTeX, unicode fraction and superscript notation,
algebraic equivalence via sympy, and Hebrew or unit text around the
numbers, including Hebrew prefix letters joined to a number by a hyphen.

The critic is told to return a bare final answer, while the stated answer
may carry units or a short justification. On the text path the check
therefore accepts when every value of the independent answer appears in
the stated answer. This guard is a safety net under the critic's own
pass 2 audit, not the only check. Answers it cannot read reliably, such
as a categorical label against a worked explanation or number words,
return None and are left to that audit.

Known limit: a single Latin letter after a number (5 m) reads as an
algebraic variable. The prompts ask for bare answers without units.
"""
from __future__ import annotations

import re

NUMERIC_TOLERANCE = 1e-6
MAX_SYMPY_LENGTH = 200

HEBREW_RE = re.compile(r"[\u0590-\u05FF]")
# In ב-0.05 or וה-5/12 the hyphen or maqaf after a Hebrew letter joins a
# prefix to the number, it is not a minus sign
HEBREW_PREFIX_HYPHEN_RE = re.compile(r"(?<=[\u05D0-\u05EA])[-\u05BE](?=[\d.])")
BIDI_MARKS_RE = re.compile(r"[\u200e\u200f\u202a-\u202e]")
THOUSANDS_RE = re.compile(r"(?<=\d),(?=\d{3}(?!\d))")
LATEX_FRAC_RE = re.compile(r"\\d?frac\{([^{}]*)\}\{([^{}]*)\}")
LATIN_WORD_RE = re.compile(r"[A-Za-z]{2,}")
FILLER_RE = re.compile(r"(התשובה היא|בערך|בקירוב)")
MATH_WORDS = {"sqrt", "sin", "cos", "tan", "log", "ln", "pi", "exp"}
WORD_RE = re.compile(r"[\w-]+")
SHORT_ANSWER_WORDS = 4

# parse_expr evaluates its input, so only plain math reaches it
SAFE_EXPR_RE = re.compile(r"[0-9a-zA-Z\s+\-*/^().]+")
STRAY_DOT_RE = re.compile(r"(?<!\d)\.|\.(?!\d)")

NUMBER = r"\d+(?:\.\d+)?"
# Whole part, optional Hebrew conjunction (ו or וה), then the fraction
MIXED = r"[-+]?\d+\s+(?:וה?-?\s*)?\d+\s*/\s*\d+"
NUMBER_RE = re.compile(
    rf"(?P<mixed>{MIXED})"
    rf"|(?P<fraction>[-+]?{NUMBER}\s*/\s*{NUMBER})"
    rf"|(?P<percent>[-+]?{NUMBER}\s*%)"
    rf"|(?P<plain>[-+]?{NUMBER})"
)
MIXED_RE = re.compile(r"([-+]?)(\d+)\s+(?:וה?-?\s*)?(\d+)\s*/\s*(\d+)")

UNICODE_FRACTIONS = {"½": "1/2", "⅓": "1/3", "⅔": "2/3", "¼": "1/4", "¾": "3/4"}
OPERATOR_SYMBOLS = {
    "\u2212": "-",
    "×": "*",
    "·": "*",
    "÷": "/",
    "²": "^2",
    "³": "^3",
    "\\cdot": "*",
    "\\times": "*",
    "$": "",
}


def _latex_frac(match: re.Match) -> str:
    numerator, denominator = match.group(1).strip(), match.group(2).strip()
    if re.fullmatch(NUMBER, numerator) and re.fullmatch(NUMBER, denominator):
        return f"{numerator}/{denominator}"
    return f"({numerator})/({denominator})"


def _clean(answer: str) -> str:
    text = BIDI_MARKS_RE.sub("", str(answer))
    text = LATEX_FRAC_RE.sub(_latex_frac, text)
    for symbol, replacement in OPERATOR_SYMBOLS.items():
        text = text.replace(symbol, replacement)
    for symbol, fraction in UNICODE_FRACTIONS.items():
        text = text.replace(symbol, f" {fraction}")
    text = HEBREW_PREFIX_HYPHEN_RE.sub(" ", text)
    text = THOUSANDS_RE.sub("", text)
    text = FILLER_RE.sub("", text)
    return re.sub(r"\s+", " ", text).strip()


def _token_values(kind: str, raw: str) -> set[float] | None:
    """Acceptable numeric readings of one token, None when undefined."""
    if kind == "mixed":
        sign, whole, numerator, denominator = MIXED_RE.fullmatch(raw).groups()
        if int(denominator) == 0:
            return None
        value = int(whole) + int(numerator) / int(denominator)
        return {-value if sign == "-" else value}
    if kind == "fraction":
        numerator, denominator = (float(part) for part in raw.split("/"))
        if denominator == 0:
            return None
        return {numerator / denominator}
    if kind == "percent":
        value = float(raw.rstrip("%").strip())
        # A percent answer may be written as 20% or 20 or 0.2
        return {value / 100.0, value}
    return {float(raw)}


def _numeric_tokens(text: str) -> list[set[float]]:
    tokens = []
    for match in NUMBER_RE.finditer(text):
        values = _token_values(match.lastgroup, match.group(match.lastgroup))
        if values is not None:
            tokens.append(values)
    return tokens


def _is_single_number(text: str) -> bool:
    return NUMBER_RE.fullmatch(text) is not None


def _close(x: float, y: float) -> bool:
    return abs(x - y) <= NUMERIC_TOLERANCE * max(abs(x), abs(y), 1.0)


def _tokens_match(left: set[float], right: set[float]) -> bool:
    return any(_close(x, y) for x in left for y in right)


def _has_text(text: str) -> bool:
    """True when the answer carries words, Hebrew or Latin, beyond
    single letter variables and known math functions."""
    if HEBREW_RE.search(text):
        return True
    return any(
        word.lower() not in MATH_WORDS for word in LATIN_WORD_RE.findall(text)
    )


def _sympy_equal(a: str, b: str) -> bool | None:
    """Algebraic equivalence, None when either side is not plain math."""
    for side in (a, b):
        if (
            len(side) > MAX_SYMPY_LENGTH
            or not SAFE_EXPR_RE.fullmatch(side)
            or STRAY_DOT_RE.search(side)
            or _has_text(side)
        ):
            return None
    try:
        from sympy import simplify
        from sympy.parsing.sympy_parser import (
            convert_xor,
            implicit_multiplication_application,
            parse_expr,
            standard_transformations,
        )

        transformations = standard_transformations + (
            implicit_multiplication_application,
            convert_xor,
        )
        left = parse_expr(a, transformations=transformations)
        right = parse_expr(b, transformations=transformations)
        return bool(simplify(left - right) == 0)
    except Exception:
        return None


def answers_equivalent(expected: str, actual: str) -> bool | None:
    """Whether the critic's independent answer (actual) agrees with the
    generator's stated answer (expected) after normalization. None means
    the guard cannot decide reliably."""
    stated, independent = _clean(expected), _clean(actual)
    if not stated or not independent:
        return stated == independent
    if stated == independent:
        return True

    stated_tokens = _numeric_tokens(stated)
    independent_tokens = _numeric_tokens(independent)

    if (
        stated_tokens
        and independent_tokens
        and _is_single_number(stated)
        and _is_single_number(independent)
    ):
        return _tokens_match(stated_tokens[0], independent_tokens[0])

    if not _has_text(stated) and not _has_text(independent):
        verdict = _sympy_equal(stated, independent)
        if verdict is not None:
            return verdict

    if stated_tokens and independent_tokens:
        return all(
            any(_tokens_match(value, candidate) for candidate in stated_tokens)
            for value in independent_tokens
        )

    if not stated_tokens and not independent_tokens:
        stated_words = set(WORD_RE.findall(stated.casefold()))
        independent_words = set(WORD_RE.findall(independent.casefold()))
        if (
            independent_words
            and len(stated_words) <= SHORT_ANSWER_WORDS
            and len(independent_words) <= SHORT_ANSWER_WORDS
        ):
            return independent_words <= stated_words

    # Categorical or verbose answers the guard cannot read reliably, the
    # critic's pass 2 audit decides these
    return None
