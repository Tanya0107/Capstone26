"""Answer leak guard unit tests (FR11, R6).

The adversarial end to end test lives in tests/test_api/test_tutor_endpoint.py.
These pin the detector itself.
"""
import pytest

from app.agents.tutoring.answer_leak import SAFEST_FALLBACK_HINT, leaks_answer


@pytest.mark.parametrize(
    ("hint", "answer", "leaks"),
    [
        # Stating the value outright, in several notations
        ("התשובה היא 17/12", "17/12", True),
        ("זה יוצא 1 5/12", "17/12", True),
        ("התוצאה היא 1.4166666666", "17/12", True),
        ("הסכום הוא 207", "207", True),
        # Safe hints that reason without giving the value away
        ("מה המכנה המשותף של 3 ו-4?", "17/12", False),
        ("נסו לחבר קודם את החלקים השלמים", "4 1/4", False),
        ("מה הבעיה בעצם מבקשת למצוא?", "207", False),
        # A number from the problem is fine when it is not the answer
        ("במתכון יש 12 עוגיות, מה היחס?", "1 1/4", False),
    ],
)
def test_quantitative_leaks(hint, answer, leaks):
    assert leaks_answer(hint, answer, "quantitative") is leaks


@pytest.mark.parametrize(
    ("hint", "answer", "leaks"),
    [
        # Reproducing the model answer, verbatim or paraphrased
        (
            "זכרו שהלוח הוא מקור ראשוני כי נכתב בתקופה הנחקרת",
            "הלוח הוא מקור ראשוני כי נכתב בתקופה הנחקרת על ידי מי שחי בה",
            True,
        ),
        ("התשובה היא ירושלים", "ירושלים", True),
        # Guiding without stating it
        ("מי כתב את המסמך, ומתי הוא נכתב ביחס לאירוע?", "מקור ראשוני", False),
        ("מה ההבדל בין עדות ישירה לפרשנות מאוחרת?", "מקור ראשוני", False),
    ],
)
def test_open_ended_leaks(hint, answer, leaks):
    assert leaks_answer(hint, answer, "open_ended") is leaks


def test_blank_inputs_are_not_leaks():
    assert leaks_answer("", "17/12", "quantitative") is False
    assert leaks_answer("רמז כלשהו", "", "quantitative") is False


def test_fallback_hint_never_leaks():
    """The last resort prompt must be safe for any exercise."""
    for answer, stype in [
        ("17/12", "quantitative"),
        ("207", "quantitative"),
        ("מקור ראשוני כי נכתב בתקופה הנחקרת", "open_ended"),
    ]:
        assert leaks_answer(SAFEST_FALLBACK_HINT, answer, stype) is False
