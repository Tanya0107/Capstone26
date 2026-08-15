"""Server-side telemetry aggregation (FR8, FR13) + affective inference inputs (FR12).

Definitions (book §Metrics):
  ATT — median duration of constructive input, excluding idle time (Baker et al., 2004)
  TCV — average time to correctly solve an enrichment unit (Gupta & Heggond, 2026)
  HSR — help requests / total problems attempted (Aleven et al., 2003)
  NGS — g = (post - pre) / (100 - pre)   (Hake, 1998)
"""
from __future__ import annotations

IDLE_CUTOFF_SECONDS = 90  # heartbeats farther apart than this count as idle. TODO: calibrate.


def compute_att(events: list[dict]) -> float:
    """Median active time on task across events, idle-time excluded."""
    raise NotImplementedError("Phase 5, Step 5.2")


def compute_tcv(events: list[dict], progress: list[dict]) -> float:
    raise NotImplementedError("Phase 5, Step 5.2")


def compute_hsr(events: list[dict]) -> float:
    """sum(hsrc_count) / count(problems attempted)."""
    raise NotImplementedError("Phase 5, Step 5.2")


def compute_ngs(pre: float, post: float) -> float:
    """Hake's normalized gain. Guard the pre==100 edge case."""
    if pre >= 100:
        return 0.0
    return (post - pre) / (100 - pre)
