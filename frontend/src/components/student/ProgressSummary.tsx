/**
 * FR13: immediate feedback on completion, plus the student's own history.
 *
 * Two blocks, either of which may be omitted, because the same component
 * serves the workspace (this unit, with the completion message) and the
 * dashboard (every unit, which is the View History use case of D10).
 *
 * R1: there is no learning gain shown here and there must not be. A gain
 * needs a pre test and a post test, both of which belong to the Phase 5
 * pilot, so this screen reports what the student submitted and says plainly
 * where a gain figure would come from instead of implying one.
 */
"use client";

import { strings } from "./strings";

export interface UnitProgress {
  submitted: number;
  total: number;
  isCompleted: boolean;
}

export interface HistoryRow {
  assignmentKey: string;
  title: string;
  submitted: number;
  total: number;
  isCompleted: boolean;
}

function Bar({ submitted, total }: { submitted: number; total: number }) {
  const percent = total > 0 ? Math.round((Math.min(submitted, total) / total) * 100) : 0;
  return (
    <div
      className="h-2 w-full min-w-0 overflow-hidden rounded-full bg-surface-sunken"
      role="progressbar"
      aria-valuenow={submitted}
      aria-valuemin={0}
      aria-valuemax={total}
      aria-label={strings.cardProgressLabel}
    >
      {/* Logical inset so the fill grows from the start edge in RTL (R10). */}
      <div className="h-full rounded-full bg-brand" style={{ inlineSize: `${percent}%` }} />
    </div>
  );
}

export default function ProgressSummary({
  unit,
  history,
}: {
  unit?: UnitProgress;
  history?: HistoryRow[];
}) {
  return (
    <section
      className="flex min-w-0 flex-col gap-5 rounded-card bg-surface p-5 shadow-card"
      aria-labelledby="progress-heading"
      data-testid="progress-summary"
    >
      <h2 id="progress-heading" className="font-display text-lg font-bold text-ink">
        {strings.progressTitle}
      </h2>

      {unit ? (
        <div className="flex min-w-0 flex-col gap-2" data-testid="progress-unit">
          {unit.isCompleted ? (
            <div
              className="flex min-w-0 flex-col gap-1 rounded-card bg-brand-soft p-4"
              role="status"
              data-testid="progress-completed"
            >
              <p className="font-display font-bold text-brand-strong">
                {strings.progressCompletedTitle}
              </p>
              <p className="text-sm text-ink">{strings.progressCompletedBody}</p>
            </div>
          ) : null}
          <p className="text-sm text-ink-muted">{strings.progressInUnit}</p>
          <p className="font-semibold text-ink" data-testid="progress-unit-count">
            <span data-testid="progress-submitted">{unit.submitted}</span>
            {` ${strings.cardProgressOf} ${unit.total} `}
            {strings.progressSubmitted}
          </p>
          <Bar submitted={unit.submitted} total={unit.total} />
        </div>
      ) : null}

      {history ? (
        <div className="flex min-w-0 flex-col gap-3" data-testid="progress-history">
          <h3 className="font-semibold text-ink">{strings.progressHistoryTitle}</h3>
          {history.length === 0 ? (
            <p className="text-sm text-ink-muted" data-testid="progress-history-empty">
              {strings.progressHistoryEmpty}
            </p>
          ) : (
            <ul className="flex min-w-0 flex-col gap-3">
              {history.map((row) => (
                <li
                  key={row.assignmentKey}
                  className="flex min-w-0 flex-col gap-1.5"
                  data-testid={`progress-history-${row.assignmentKey}`}
                >
                  <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-2">
                    <span className="min-w-0 font-medium text-ink">{row.title}</span>
                    <span className="text-sm text-ink-muted">
                      {row.isCompleted
                        ? strings.progressHistoryDone
                        : `${row.submitted} ${strings.cardProgressOf} ${row.total}`}
                    </span>
                  </div>
                  <Bar submitted={row.submitted} total={row.total} />
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}

      <p className="text-sm text-ink-muted" data-testid="progress-gains-note">
        {strings.progressGainsNote}
      </p>
    </section>
  );
}
