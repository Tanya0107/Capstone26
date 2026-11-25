/**
 * FR10: prompt, answer box and submit, with ScaffoldingSteps on demand.
 *
 * Presentational on purpose. The draft text, the revealed step count and
 * every write live in the workspace page, so this component can be read
 * next to the screenshot in the book and nothing about buffering or
 * Firestore is hidden inside it.
 *
 * The answer box is the one place in the product where a child does the
 * work, so its state is always visible: saved on this device, sent, or
 * waiting for a connection. NFR7 is only a promise if the student can see
 * which of the three it is.
 */
"use client";

import ScaffoldingSteps from "./ScaffoldingSteps";
import { strings } from "./strings";
import type { StoredExercise } from "@/types/models";

export type AnswerState = "draft" | "submitted" | "pending";

export default function ExerciseCard({
  exercise,
  position,
  total,
  draft,
  onDraftChange,
  onSubmit,
  state,
  bufferingOn,
  error,
  revealedSteps,
  onRevealStep,
  onCollapseSteps,
}: {
  exercise: StoredExercise;
  position: number;
  total: number;
  draft: string;
  onDraftChange: (text: string) => void;
  onSubmit: () => void;
  state: AnswerState;
  bufferingOn: boolean;
  error: string | null;
  revealedSteps: number;
  onRevealStep: () => void;
  onCollapseSteps: () => void;
}) {
  const statusText =
    state === "pending"
      ? strings.answerPending
      : state === "submitted"
        ? strings.answerSubmitted
        : bufferingOn
          ? strings.answerSaved
          : strings.answerSavedOff;

  return (
    <article
      className="flex min-w-0 flex-col gap-5 rounded-card bg-surface p-5 shadow-card lg:p-6"
      aria-labelledby="exercise-heading"
      data-testid="exercise-card"
      data-exercise-key={exercise.exerciseId}
      data-order={exercise.order}
      data-state={state}
    >
      <header className="flex min-w-0 flex-col gap-2">
        <p className="text-sm font-semibold text-brand-strong" data-testid="exercise-position">
          {`${strings.wsExerciseLabel} ${position} ${strings.wsOf} ${total}`}
        </p>
        <h2
          id="exercise-heading"
          className="min-w-0 whitespace-pre-line font-display text-xl font-bold leading-relaxed text-ink"
          data-testid="exercise-prompt"
        >
          {exercise.prompt}
        </h2>
      </header>

      <ScaffoldingSteps
        steps={exercise.scaffoldSteps}
        revealed={revealedSteps}
        onReveal={onRevealStep}
        onCollapse={onCollapseSteps}
      />

      <div className="flex min-w-0 flex-col gap-2">
        <label htmlFor="answer" className="font-semibold text-ink">
          {strings.answerLabel}
        </label>
        <textarea
          id="answer"
          value={draft}
          onChange={(event) => onDraftChange(event.target.value)}
          placeholder={strings.answerPlaceholder}
          rows={6}
          className="min-w-0 rounded-card border border-line bg-surface p-3 text-ink placeholder:text-ink-muted"
          data-testid="answer-input"
        />
        <p
          className={`text-sm ${state === "pending" ? "text-warn" : "text-ink-muted"}`}
          data-testid="answer-status"
          data-answer-state={state}
        >
          {statusText}
        </p>
        {error ? (
          <p role="alert" className="text-sm font-semibold text-danger" data-testid="answer-error">
            {error}
          </p>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={onSubmit}
          className="rounded-card bg-brand px-5 py-2.5 font-semibold text-brand-contrast"
          data-testid="answer-submit"
        >
          {state === "draft" ? strings.answerSubmit : strings.answerResubmit}
        </button>
      </div>
    </article>
  );
}
