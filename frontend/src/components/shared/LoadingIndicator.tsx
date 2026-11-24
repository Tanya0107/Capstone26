/**
 * Staged loading indicator (NFR8): during curriculum generation, surface the
 * pipeline stage ("Designing lessons", "Critic verifying math") instead of a
 * bare spinner, the perceived latency mitigation in book section Challenges 2.
 *
 * Honest limit, Step 4.1: POST /api/generation is one request that returns
 * the finished package, so the browser has no progress channel and cannot
 * know the server's real stage. The schedule below is therefore an
 * estimate, and the estimates are the measured per stage medians of the
 * DEV runs in evaluation/results/dev_runs/summary.json, not guesses. The UI
 * shows no percentage and no countdown, because those would claim a
 * precision the client does not have. When the estimated schedule runs out
 * before the response lands, the indicator says the critic asked for a
 * revision, which is what actually happens: the orchestrator routes back to
 * lesson design for up to two regeneration cycles (FR3). Replacing this
 * with real stage events would mean streaming generation progress the way
 * D15 streams tutor turns.
 */
"use client";

import { useEffect, useState } from "react";
import { strings } from "./strings";

export interface PipelineStage {
  id: string;
  label: string;
  estimateSeconds: number;
}

/** The six orchestrator stages, in graph order (backend/app/agents/orchestrator.py). */
export const GENERATION_STAGES: PipelineStage[] = [
  { id: "intake", label: "קורא את הדרישות ואת תקני משרד החינוך", estimateSeconds: 28 },
  { id: "scope_sequence", label: "בונה את רצף השבועות", estimateSeconds: 20 },
  { id: "lesson_design", label: "מתכנן את השיעורים והתרגילים", estimateSeconds: 94 },
  { id: "assessment_design", label: "מעצב את ההערכה והמחוון", estimateSeconds: 45 },
  { id: "critic", label: "המבקר פותר את התרגילים באופן עצמאי", estimateSeconds: 12 },
  { id: "package", label: "מרכיב את החבילה", estimateSeconds: 7 },
];

function formatElapsed(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(whole / 60);
  return `${minutes}:${String(whole % 60).padStart(2, "0")}`;
}

/** Index of the stage the estimated schedule is on, or stages.length once
 * the whole schedule has elapsed and the run is in a regeneration cycle. */
function stageIndexAt(elapsedSeconds: number, stages: PipelineStage[]): number {
  let boundary = 0;
  for (let index = 0; index < stages.length; index += 1) {
    boundary += stages[index].estimateSeconds;
    if (elapsedSeconds < boundary) return index;
  }
  return stages.length;
}

export default function LoadingIndicator({
  stages = GENERATION_STAGES,
  title = strings.generationTitle,
}: {
  stages?: PipelineStage[];
  title?: string;
}) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const startedAt = Date.now();
    const timer = window.setInterval(
      () => setElapsed((Date.now() - startedAt) / 1000),
      1000,
    );
    return () => window.clearInterval(timer);
  }, []);

  const current = stageIndexAt(elapsed, stages);
  const holding = current >= stages.length;
  const activeLabel = holding ? strings.holdLabel : stages[current].label;

  return (
    <section
      className="rounded-card border border-line bg-surface p-6 shadow-card"
      data-testid="loading-indicator"
    >
      <h2 className="font-display text-xl font-bold">{title}</h2>
      <p className="mt-1 text-sm text-ink-muted">{strings.generationHint}</p>

      {/* Only the active stage is announced. The elapsed clock sits outside
          the live region so it is not read aloud once per second. */}
      <p role="status" className="sr-only" data-testid="loading-stage-announcement">
        {activeLabel}
      </p>

      <ol className="mt-5 space-y-2">
        {stages.map((stage, index) => {
          const done = index < current;
          const active = index === current;
          const state = done
            ? strings.stageDone
            : active
              ? strings.stageActive
              : strings.stagePending;
          return (
            <li
              key={stage.id}
              data-testid={`loading-stage-${stage.id}`}
              data-state={done ? "done" : active ? "active" : "pending"}
              className={`flex items-center gap-3 ${
                done ? "text-ink-muted" : active ? "text-ink" : "text-ink-muted/60"
              }`}
            >
              <span
                aria-hidden="true"
                className={`size-2.5 shrink-0 rounded-full ${
                  done
                    ? "bg-ok"
                    : active
                      ? "animate-breathe bg-brand"
                      : "border border-line bg-surface"
                }`}
              />
              <span className={active ? "font-semibold" : undefined}>{stage.label}</span>
              <span className="sr-only">{state}</span>
            </li>
          );
        })}
      </ol>

      {holding && (
        <p
          className="mt-4 flex items-center gap-3 font-semibold text-ink"
          data-testid="loading-hold"
        >
          <span aria-hidden="true" className="size-2.5 shrink-0 animate-breathe rounded-full bg-accent" />
          {strings.holdLabel}
        </p>
      )}

      <p className="mt-5 text-sm text-ink-muted">
        {strings.generationElapsed}{" "}
        <span dir="ltr" className="font-medium tabular-nums text-ink">
          {formatElapsed(elapsed)}
        </span>
      </p>
    </section>
  );
}
