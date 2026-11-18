"""Full stack generation runs through the HTTP API (Step 3.6 acceptance).

Teacher token from the Auth emulator, POST /api/generation against a live
uvicorn, then read the Firestore emulator back to prove the module, the
exercises and the teacher only solutions all landed and that no answer
field leaked into a student readable exercise doc (R6, D11).

DEV numbers only (R1). Nothing here is an evaluation result: one machine,
one brief, the emulator suite, live model latency that varies with
provider load. The NFR2b figure is a Phase B target and stays one.

Prerequisites, from the repo root:
    (1) firebase emulators:start --project demo-enrichment     # in firebase/
    (2) cd backend && .venv/bin/python -m scripts.seed_users
    (3) cd backend && .venv/bin/uvicorn app.main:app --port 8000

Then, from backend/:
    .venv/bin/python -u -m scripts.dev_latency_runs --runs 10
    .venv/bin/python -u -m scripts.dev_latency_runs --runs 1 --brief science_ecosystems_g5

Runs accumulate into generation_latency.json, so a campaign can be split
across sessions. Percentiles are recomputed over everything recorded for
the same brief.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import math
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.config import get_settings
from app.core.schemas import CurriculumPackage
from scripts.dev_run_pipeline import BRIEFS

RESULTS_PATH = (
    Path(__file__).resolve().parent.parent.parent
    / "evaluation"
    / "results"
    / "dev_runs"
    / "generation_latency.json"
)

TEACHER_EMAIL = "teacher1@demo.school"
TEACHER_PASSWORD = "Demo1234"
# Longer than the NFR2b budget on purpose: a run that overruns the budget
# should be recorded as a 504 from the server, not cut off by the client
CLIENT_TIMEOUT_S = 1500.0


async def teacher_token(host: str) -> tuple[str, str]:
    """Sign in against the Auth emulator and return (id_token, uid).

    The emulator ignores the API key but the REST shape still requires one.
    """
    url = (
        f"http://{host}/identitytoolkit.googleapis.com/v1/"
        "accounts:signInWithPassword?key=emulator"
    )
    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.post(
            url,
            json={
                "email": TEACHER_EMAIL,
                "password": TEACHER_PASSWORD,
                "returnSecureToken": True,
            },
        )
    if response.status_code != 200:
        raise SystemExit(
            f"Auth emulator sign in failed ({response.status_code}). "
            "Are the emulators up and scripts.seed_users run? "
            f"{response.text[:300]}"
        )
    payload = response.json()
    return payload["idToken"], payload["localId"]


def verify_persistence(module_key: str, package: CurriculumPackage, uid: str) -> dict:
    """Read the emulator back and check the Fig 4 and D11 split.

    The important assertion is the negative one: a student readable
    exercise doc must carry no answer field. R6 treats a leak there as a
    release blocker, so it is re-checked at the persistence layer and not
    only in the tutor.
    """
    from google.cloud.firestore_v1.base_query import FieldFilter

    from app.core.firestore import get_db

    db = get_db()
    checks: dict = {}
    module = db.collection("curriculumModules").document(module_key).get()
    checks["module_exists"] = module.exists
    module_doc = module.to_dict() or {}
    checks["creator_is_caller"] = module_doc.get("creatorTeacherKey") == uid
    checks["quality_scores_persisted"] = isinstance(
        module_doc.get("qualityScores"), dict
    )

    expected = [
        exercise for lesson in package.lessons for exercise in lesson.exercises
    ]
    exercise_docs = list(
        db.collection("exercises")
        .where(filter=FieldFilter("moduleKey", "==", module_key))
        .stream()
    )
    checks["exercise_count_matches"] = len(exercise_docs) == len(expected)
    checks["exercises_expected"] = len(expected)
    checks["exercises_found"] = len(exercise_docs)

    answer_fields = ("correctAnswer", "socraticHints")
    leaked = [
        snapshot.id
        for snapshot in exercise_docs
        if any(field in (snapshot.to_dict() or {}) for field in answer_fields)
    ]
    checks["student_readable_docs_without_answers"] = not leaked
    checks["leaking_exercise_ids"] = leaked

    solutions = 0
    for snapshot in exercise_docs:
        solution = db.collection("exerciseSolutions").document(snapshot.id).get()
        if solution.exists and (solution.to_dict() or {}).get("correctAnswer"):
            solutions += 1
    checks["solutions_found"] = solutions
    checks["every_exercise_has_a_solution"] = solutions == len(exercise_docs)

    checks["ok"] = all(
        checks[key]
        for key in (
            "module_exists",
            "creator_is_caller",
            "quality_scores_persisted",
            "exercise_count_matches",
            "student_readable_docs_without_answers",
            "every_exercise_has_a_solution",
        )
    )
    return checks


async def one_run(
    client: httpx.AsyncClient, token: str, uid: str, brief: str, payload: dict
) -> dict:
    record: dict = {
        "brief": brief,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
    started = time.monotonic()
    try:
        response = await client.post(
            "/api/generation",
            json={**payload, "teacherKey": uid},
            headers={"Authorization": f"Bearer {token}"},
        )
    except Exception as exc:
        record.update(
            status="error",
            wall_seconds=round(time.monotonic() - started, 2),
            error=f"{type(exc).__name__}: {exc}",
        )
        print(f"    transport error after {record['wall_seconds']}s: {record['error']}")
        return record

    record["wall_seconds"] = round(time.monotonic() - started, 2)
    record["http_status"] = response.status_code

    if response.status_code == 504:
        record.update(status="timeout", body=response.json())
        print(f"    504 budget exceeded after {record['wall_seconds']}s")
        return record
    if response.status_code != 200:
        record.update(status="error", error=response.text[:400])
        print(f"    HTTP {response.status_code} after {record['wall_seconds']}s")
        return record

    body = response.json()
    try:
        package = CurriculumPackage.model_validate(body)
    except Exception as exc:
        record.update(status="invalid_body", error=f"{type(exc).__name__}: {exc}")
        print(f"    body failed CurriculumPackage validation: {exc}")
        return record

    record.update(
        status="ok",
        response_validates=True,
        module_key=package.module_key,
        server_latency_seconds=package.generation_latency_seconds,
        critic_approved=package.critic_report.approved,
        regeneration_cycles_used=package.critic_report.regeneration_cycles_used,
        critic_issue_count=len(package.critic_report.issues),
        # The issues themselves, not just the count: an unapproved package
        # needs its reasons on record to tell a real content error from a
        # critic false positive without re-running a 460s generation
        critic_issues=[
            issue.model_dump(by_alias=True) for issue in package.critic_report.issues
        ],
        lesson_count=len(package.lessons),
        exercise_count=sum(len(lesson.exercises) for lesson in package.lessons),
        rouge_l=package.quality_scores.rouge_l,
        reference_unit=package.quality_scores.reference_unit,
        reference_validated=package.quality_scores.reference_validated,
    )
    record["persistence"] = await asyncio.to_thread(
        verify_persistence, package.module_key, package, uid
    )
    print(
        f"    ok in {record['wall_seconds']}s, approved={record['critic_approved']}, "
        f"cycles={record['regeneration_cycles_used']}, "
        f"exercises={record['exercise_count']}, rougeL={record['rouge_l']}, "
        f"persisted={record['persistence']['ok']}"
    )
    return record


def percentile(values: list[float], q: float) -> float:
    """Nearest rank percentile, the method recorded next to the number."""
    ordered = sorted(values)
    rank = max(1, math.ceil(q / 100.0 * len(ordered)))
    return ordered[rank - 1]


def summarize(runs: list[dict], budget_s: int) -> dict:
    latencies = [r["wall_seconds"] for r in runs if r.get("status") == "ok"]
    summary: dict = {
        "runs_recorded": len(runs),
        "runs_ok": len(latencies),
        "runs_timed_out": sum(1 for r in runs if r.get("status") == "timeout"),
        "runs_failed": sum(
            1 for r in runs if r.get("status") in ("error", "invalid_body")
        ),
        "budget_seconds": budget_s,
    }
    if latencies:
        summary.update(
            min_seconds=min(latencies),
            p50_seconds=percentile(latencies, 50),
            p95_seconds=percentile(latencies, 95),
            max_seconds=max(latencies),
            within_budget=sum(1 for value in latencies if value <= budget_s),
        )
    summary["percentile_method"] = (
        "nearest rank over successful runs. With 10 samples the p95 is the "
        "maximum observed value, so it bounds this sample rather than "
        "estimating a population p95. Treat it as a DEV observation (R1)."
    )
    summary["all_responses_validated"] = all(
        r.get("response_validates") for r in runs if r.get("status") == "ok"
    )
    summary["all_persistence_checks_passed"] = all(
        r.get("persistence", {}).get("ok") for r in runs if r.get("status") == "ok"
    )
    return summary


def write_results(brief: str, new_runs: list[dict], budget_s: int) -> dict:
    """Append this session's runs and recompute the per brief summary."""
    document: dict = {
        "label": "DEV runs, not evaluation results (R1)",
        "measures": "NFR2b end to end generation latency through POST /api/generation",
        "environment": "local emulator suite, single uvicorn worker, live LLM providers",
        "briefs": {},
    }
    if RESULTS_PATH.exists():
        document.update(json.loads(RESULTS_PATH.read_text(encoding="utf-8")))
    briefs = document.setdefault("briefs", {})
    entry = briefs.setdefault(brief, {"runs": []})
    entry["runs"].extend(new_runs)
    entry["summary"] = summarize(entry["runs"], budget_s)
    document["updated_at"] = datetime.now(timezone.utc).isoformat()
    RESULTS_PATH.parent.mkdir(parents=True, exist_ok=True)
    RESULTS_PATH.write_text(
        json.dumps(document, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    return entry["summary"]


async def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--runs", type=int, default=10)
    parser.add_argument("--brief", default="math_fractions_g5")
    parser.add_argument("--base-url", default="http://localhost:8000")
    args = parser.parse_args()

    briefs = dict(BRIEFS)
    if args.brief not in briefs:
        raise SystemExit(f"Unknown brief {args.brief!r}. Known: {sorted(briefs)}")
    payload = briefs[args.brief].model_dump(by_alias=True)

    settings = get_settings()
    if not settings.use_firestore_emulator:
        raise SystemExit("Refusing to run DEV latency runs outside emulator mode")

    async with httpx.AsyncClient(timeout=10.0) as probe:
        try:
            health = await probe.get(f"{args.base_url}/healthz")
            health.raise_for_status()
        except Exception as exc:
            raise SystemExit(
                f"No server at {args.base_url} ({exc}). Start it with "
                "'.venv/bin/uvicorn app.main:app --port 8000' from backend/."
            ) from exc

    token, uid = await teacher_token(settings.firebase_auth_emulator_host)
    print(f"Signed in as {TEACHER_EMAIL} (uid {uid})")
    print(f"{args.runs} run(s) of brief {args.brief} against {args.base_url}\n")

    records = []
    async with httpx.AsyncClient(
        base_url=args.base_url, timeout=CLIENT_TIMEOUT_S
    ) as client:
        for index in range(1, args.runs + 1):
            print(f"=== run {index}/{args.runs}")
            records.append(await one_run(client, token, uid, args.brief, payload))

    summary = write_results(args.brief, records, settings.generation_timeout_seconds)
    print(f"\nSummary for {args.brief} (all runs recorded so far):")
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    print(f"\nWritten to {RESULTS_PATH}")


if __name__ == "__main__":
    asyncio.run(main())
