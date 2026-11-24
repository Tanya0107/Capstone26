"""End to end pipeline dev runs with real models (Step 3.3 acceptance).

DEV runs only (R1): outputs are development evidence, not evaluation
results. Saves one record per brief (package or failure, plus per stage
timings) under evaluation/results/dev_runs/ and merges summary.json.

Run from backend/:
    .venv/bin/python -u -m scripts.dev_run_pipeline                    # all briefs
    .venv/bin/python -u -m scripts.dev_run_pipeline math_fractions_g5  # subset

The NFR2 budget (15s) is intentionally overridden here: dev runs measure
real pipeline latency without truncating it, and the measured numbers are
recorded as DEV observations for the Step 3.6 latency work.
"""
from __future__ import annotations

import asyncio
import json
import logging
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.agents.orchestrator import default_agents, run_pipeline
from app.core.schemas import GenerationRequest

RESULTS_DIR = (
    Path(__file__).resolve().parent.parent.parent / "evaluation" / "results" / "dev_runs"
)

DEV_TIMEOUT_S = 1200.0

BRIEFS: list[tuple[str, GenerationRequest]] = [
    (
        "math_fractions_g5",
        GenerationRequest(
            teacher_key="t_dev",
            school_key="s_dev",
            subject="math",
            goals="להעמיק את הבנת השברים דרך בעיות בישול ומתכונים מהעולם האמיתי",
            topics=["שברים", "יחסים"],
            grade_level="5",
            difficulty_level=3,
        ),
    ),
    (
        "science_ecosystems_g5",
        GenerationRequest(
            teacher_key="t_dev",
            school_key="s_dev",
            subject="science",
            goals="לחקור מערכות אקולוגיות מקומיות ולפתח מיומנויות חקר דרך תצפיות בחצר בית הספר",
            topics=["מערכות אקולוגיות", "שרשרות מזון"],
            grade_level="5",
            difficulty_level=3,
        ),
    ),
    (
        "history_ancient_g6",
        GenerationRequest(
            teacher_key="t_dev",
            school_key="s_dev",
            subject="history",
            goals="להשוות בין תרבויות קדומות דרך ניתוח מקורות ראשוניים ומשניים",
            topics=["מסופוטמיה", "מצרים העתיקה"],
            grade_level="6",
            difficulty_level=3,
        ),
    ),
    (
        "math_hard_percent_g6",
        GenerationRequest(
            teacher_key="t_dev",
            school_key="s_dev",
            subject="math",
            goals=(
                "בעיות אתגר קשות במיוחד באחוזים ובשברים עם חישובים רב שלביים, "
                "כולל אחוז מאחוז, שינויים עוקבים והנחות מצטברות, ברמת תחרות"
            ),
            topics=["אחוז מאחוז", "שינויים מצטברים", "בעיות תחרות"],
            grade_level="6",
            difficulty_level=5,
        ),
    ),
]

SUMMARY_KEYS = (
    "brief",
    "status",
    "wall_seconds",
    "critic_approved",
    "regeneration_cycles_used",
    "critic_issue_count",
    "error",
)


class TimedAgent:
    """Records wall time per stage invocation for latency analysis."""

    def __init__(self, stage: str, inner, timings: list[dict]):
        self.stage = stage
        self.inner = inner
        self.timings = timings

    async def run(self, state: dict) -> dict:
        started = time.monotonic()
        entry: dict = {"stage": self.stage}
        try:
            state = await self.inner.run(state)
            if self.stage == "critic":
                report = state["critic_report"]
                entry["approved"] = report.approved
                entry["issues"] = [issue.model_dump() for issue in report.issues]
            return state
        finally:
            entry["seconds"] = round(time.monotonic() - started, 2)
            self.timings.append(entry)
            print(f"      {self.stage}: {entry['seconds']}s")
            for issue in entry.get("issues", []):
                print(
                    f"        - #{issue['exercise_order']} {issue['issue_type']}: "
                    f"{issue['detail'][:160]}"
                )


def stage_totals(timings: list[dict]) -> dict[str, float]:
    totals: dict[str, float] = {}
    for entry in timings:
        totals[entry["stage"]] = round(totals.get(entry["stage"], 0.0) + entry["seconds"], 2)
    return totals


async def run_one(name: str, request: GenerationRequest) -> dict:
    print(f"=== {name} (subject={request.subject}, difficulty={request.difficulty_level})")
    timings: list[dict] = []
    agents = {
        stage: TimedAgent(stage, agent, timings)
        for stage, agent in default_agents().items()
    }
    record: dict = {
        "label": "DEV run, not an evaluation result (R1)",
        "brief": name,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "dev_timeout_seconds": DEV_TIMEOUT_S,
        "stage_timings": timings,
    }
    started = time.monotonic()
    try:
        package = await run_pipeline(
            request, rag_context=[], agents=agents, timeout_s=DEV_TIMEOUT_S
        )
    except Exception as exc:
        record.update(
            status="failed",
            error=f"{type(exc).__name__}: {exc}",
            wall_seconds=round(time.monotonic() - started, 2),
        )
        print(f"    FAILED after {record['wall_seconds']}s: {record['error']}")
    else:
        record.update(
            status="ok",
            wall_seconds=round(time.monotonic() - started, 2),
            critic_approved=package.critic_report.approved,
            regeneration_cycles_used=package.critic_report.regeneration_cycles_used,
            critic_issue_count=len(package.critic_report.issues),
            package=package.model_dump(by_alias=True),
        )
        print(
            f"    ok in {record['wall_seconds']}s, "
            f"approved={record['critic_approved']}, "
            f"cycles={record['regeneration_cycles_used']}, "
            f"issues={record['critic_issue_count']}"
        )
    record["stage_totals"] = stage_totals(timings)
    (RESULTS_DIR / f"{name}.json").write_text(
        json.dumps(record, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    return record


def update_summary(records: list[dict]) -> None:
    """Merge new records into summary.json keyed by brief name, so subset
    runs never discard earlier results."""
    path = RESULTS_DIR / "summary.json"
    runs: dict[str, dict] = {}
    if path.exists():
        for entry in json.loads(path.read_text(encoding="utf-8")).get("runs", []):
            runs[entry["brief"]] = entry
    for record in records:
        entry = {key: record[key] for key in SUMMARY_KEYS if key in record}
        entry["stage_totals"] = record["stage_totals"]
        runs[record["brief"]] = entry
    ordered = [runs[name] for name, _ in BRIEFS if name in runs]
    path.write_text(
        json.dumps(
            {"label": "DEV runs, not evaluation results (R1)", "runs": ordered},
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )


async def main() -> None:
    logging.basicConfig(
        level=logging.WARNING, format="      [%(levelname)s] %(name)s: %(message)s"
    )
    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    known = {name for name, _ in BRIEFS}
    selected = set(sys.argv[1:])
    if selected - known:
        sys.exit(f"Unknown briefs: {sorted(selected - known)}")
    records = []
    for name, request in BRIEFS:
        if selected and name not in selected:
            continue
        records.append(await run_one(name, request))
    update_summary(records)
    print("\nSummary merged into evaluation/results/dev_runs/summary.json")


if __name__ == "__main__":
    asyncio.run(main())
