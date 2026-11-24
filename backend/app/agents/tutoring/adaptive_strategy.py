"""Adaptive Strategy, FR12 affective state inference (privacy preserving).

No cameras, audio or biometrics (book Challenges 4). Pure behavioural
heuristics over the TelemetrySnapshot, interpreted through ICAP:

  frustrated  high HSR plus rising idle gaps plus repeated wrong attempts
  bored       long idle, low HSR, shallow or passive messages
  engaged     steady ATT with constructive attempts

Output calibrates the bot: tone, and how fast the hint ladder escalates.

Thresholds are constants with a stated rationale, NOT calibrated against
real students yet. Phase 5 should fit them to pilot telemetry and record
the distribution as evidence, the same obligation as the memory bank
thresholds. Until then treat an inferred state as a weak signal: it only
shifts tone and hint pacing, it never changes the pedagogy.
"""
from app.core.schemas import AffectiveState, TelemetrySnapshot

# Half or more of attempted problems needed help, the student is leaning on
# the bot rather than progressing.
FRUSTRATED_HSR = 0.5
# Sustained help seeking on its own is enough, even without stalling.
HIGH_HSR = 0.7
# A full minute between constructive inputs reads as stuck, not thinking.
FRUSTRATED_IDLE_SECONDS = 60.0
# Two minutes idle while NOT asking for help reads as disengaged.
BORED_IDLE_SECONDS = 120.0
BORED_HSR = 0.1
# A minute of genuine time on task before engagement is credited.
ENGAGED_MIN_ATT_SECONDS = 60.0


def assess(snapshot: TelemetrySnapshot | None) -> AffectiveState:
    """Infer affective state from behaviour alone. Unknown is a valid and
    common answer, especially early in a session."""
    if snapshot is None:
        return AffectiveState.unknown

    hsr = snapshot.hsr
    idle = snapshot.idle_seconds
    att = snapshot.att_seconds

    # Frustration: heavy help seeking, either sustained or paired with stalling
    if hsr is not None:
        if hsr >= HIGH_HSR:
            return AffectiveState.frustrated
        if hsr >= FRUSTRATED_HSR and idle >= FRUSTRATED_IDLE_SECONDS:
            return AffectiveState.frustrated

    # Boredom: long idle while NOT asking for help. The HSR check is what
    # separates this from frustration, both show long idle gaps.
    if idle >= BORED_IDLE_SECONDS and (hsr is None or hsr <= BORED_HSR):
        return AffectiveState.bored

    # Engagement: real time on task, not stalling, not leaning on hints
    if (
        att >= ENGAGED_MIN_ATT_SECONDS
        and idle < FRUSTRATED_IDLE_SECONDS
        and (hsr is None or hsr < FRUSTRATED_HSR)
    ):
        return AffectiveState.engaged

    return AffectiveState.unknown


TONE_BY_STATE = {
    AffectiveState.frustrated: "encouraging",
    AffectiveState.bored: "energizing",
    AffectiveState.engaged: "neutral",
    AffectiveState.unknown: "neutral",
}


def tone_for(state: AffectiveState) -> str:
    return TONE_BY_STATE.get(state, "neutral")
