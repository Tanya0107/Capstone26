"""Adaptive Strategy — FR12 affective-state inference (privacy-preserving).

No cameras/audio/biometrics (book §Challenges #4). Pure behavioral heuristics
over the TelemetrySnapshot, interpreted through ICAP:

  frustrated ~ high HSR + rising idle gaps + repeated wrong attempts
  bored      ~ long idle + low HSR + shallow/passive messages
  engaged    ~ steady ATT + constructive attempts

Output calibrates the bot: tone (encouraging vs energizing) and hint frequency
(faster ladder when frustrated; withhold hints + pose challenge when bored).
Thresholds start as constants; calibrate against pilot data in Phase 5.
"""
from app.core.schemas import AffectiveState, TelemetrySnapshot


def assess(snapshot: TelemetrySnapshot | None) -> AffectiveState:
    if snapshot is None:
        return AffectiveState.unknown
    raise NotImplementedError("Phase 3, Step 3.5 — heuristic rules over ATT/HSR/idle")
