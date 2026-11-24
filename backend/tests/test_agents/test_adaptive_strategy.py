"""FR12 affective inference tests, pure functions, no LLM needed."""
import pytest

from app.agents.tutoring.adaptive_strategy import assess, tone_for
from app.core.schemas import AffectiveState, TelemetrySnapshot


def snap(att=0.0, hsr=None, idle=0.0, tcv=None):
    return TelemetrySnapshot(att_seconds=att, hsr=hsr, idle_seconds=idle, tcv_seconds=tcv)


def test_high_hsr_and_idle_maps_to_frustrated():
    assert assess(snap(att=200, hsr=0.55, idle=75)) is AffectiveState.frustrated


def test_sustained_help_seeking_alone_is_frustrated():
    """Heavy help seeking counts even without stalling."""
    assert assess(snap(att=200, hsr=0.8, idle=5)) is AffectiveState.frustrated


def test_long_idle_without_help_seeking_is_bored():
    assert assess(snap(att=300, hsr=0.05, idle=180)) is AffectiveState.bored


def test_long_idle_with_help_seeking_is_not_bored():
    """HSR is what separates boredom from frustration, both idle a lot."""
    assert assess(snap(att=300, hsr=0.6, idle=180)) is AffectiveState.frustrated


def test_steady_work_is_engaged():
    assert assess(snap(att=120, hsr=0.2, idle=10)) is AffectiveState.engaged


def test_missing_snapshot_is_unknown():
    assert assess(None) is AffectiveState.unknown


def test_session_start_is_unknown_not_engaged():
    """Early in a session there is not enough behaviour to infer from."""
    assert assess(snap(att=5, hsr=None, idle=2)) is AffectiveState.unknown


@pytest.mark.parametrize(
    ("state", "tone"),
    [
        (AffectiveState.frustrated, "encouraging"),
        (AffectiveState.bored, "energizing"),
        (AffectiveState.engaged, "neutral"),
        (AffectiveState.unknown, "neutral"),
    ],
)
def test_tone_follows_state(state, tone):
    assert tone_for(state) == tone


# --- hint ladder policy (question_generator.choose_hint_level) ---

from app.agents.tutoring.question_generator import choose_hint_level  # noqa: E402


def test_ladder_climbs_one_rung_when_stuck():
    assert choose_hint_level(1, AffectiveState.unknown, False, "misconception") == 2


def test_ladder_holds_on_partial_progress():
    """A partial answer means the current rung is working. Piling on more
    scaffolding would take the thinking away from a student who is moving."""
    assert choose_hint_level(2, AffectiveState.unknown, False, "partial") == 2


def test_ladder_holds_on_correct():
    assert choose_hint_level(3, AffectiveState.engaged, False, "correct") == 3


def test_repeated_failure_climbs_even_on_partial():
    """Persistent non correct attempts override the hold."""
    assert choose_hint_level(1, AffectiveState.unknown, True, "partial") == 3


def test_frustration_climbs_two_rungs():
    assert choose_hint_level(1, AffectiveState.frustrated, False, "misconception") == 3


def test_boredom_holds_position():
    assert choose_hint_level(3, AffectiveState.bored, False, "misconception") == 3


def test_ladder_is_clamped():
    assert choose_hint_level(4, AffectiveState.frustrated, True, "misconception") == 4
    assert choose_hint_level(0, AffectiveState.unknown, False, "misconception") == 1
