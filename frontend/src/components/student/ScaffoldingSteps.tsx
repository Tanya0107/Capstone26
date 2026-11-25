/**
 * FR10 automated task breakdown, with progressive disclosure.
 *
 * The steps arrive with the exercise, but a child who can see all of them
 * at once has been handed a recipe rather than a scaffold, so they are
 * revealed one at a time and only on request. Revealed count is owned by
 * the workspace, which resets it per exercise and which is where the help
 * seeking telemetry of Step 4.5 will hang off onReveal.
 *
 * These steps are not the Socratic hints. Hints live in exerciseSolutions
 * and never reach this client (R6, D11).
 */
"use client";

import { strings } from "./strings";

export default function ScaffoldingSteps({
  steps,
  revealed,
  onReveal,
  onCollapse,
}: {
  steps: string[];
  revealed: number;
  onReveal: () => void;
  onCollapse: () => void;
}) {
  if (steps.length === 0) {
    return (
      <p className="text-sm text-ink-muted" data-testid="scaffold-none">
        {strings.scaffoldNone}
      </p>
    );
  }

  const shown = Math.min(revealed, steps.length);
  const allShown = shown === steps.length;

  return (
    <section
      className="flex min-w-0 flex-col gap-3 rounded-card bg-surface-sunken p-4"
      aria-labelledby="scaffold-heading"
      data-testid="scaffold"
      data-revealed={shown}
      data-total={steps.length}
    >
      <h3 id="scaffold-heading" className="font-display font-semibold text-ink">
        {strings.scaffoldTitle}
      </h3>

      {shown === 0 ? (
        <p className="text-sm text-ink-muted">{strings.scaffoldIntro}</p>
      ) : (
        <ol className="flex min-w-0 list-none flex-col gap-3" aria-live="polite">
          {steps.slice(0, shown).map((step, index) => (
            <li
              key={index}
              className="flex min-w-0 items-start gap-3"
              data-testid={`scaffold-step-${index + 1}`}
            >
              <span
                aria-hidden="true"
                className="mt-0.5 flex h-7 w-7 flex-none items-center justify-center rounded-full bg-brand-soft text-sm font-bold text-brand-strong"
              >
                {index + 1}
              </span>
              <span className="min-w-0 flex-1 whitespace-pre-line text-ink">
                <span className="sr-only">{`${strings.scaffoldStep} ${index + 1}: `}</span>
                {step}
              </span>
            </li>
          ))}
        </ol>
      )}

      <div className="flex flex-wrap items-center gap-3">
        {allShown ? (
          <p className="text-sm text-ink-muted" data-testid="scaffold-all-shown">
            {strings.scaffoldAllShown}
          </p>
        ) : (
          <button
            type="button"
            onClick={onReveal}
            className="rounded-card bg-brand px-4 py-2 font-semibold text-brand-contrast"
            data-testid="scaffold-reveal"
          >
            {shown === 0 ? strings.scaffoldRevealFirst : strings.scaffoldReveal}
          </button>
        )}
        {shown > 0 ? (
          <button
            type="button"
            onClick={onCollapse}
            className="rounded-card border border-line px-3 py-1.5 text-sm font-semibold text-ink-muted"
            data-testid="scaffold-hide"
          >
            {strings.scaffoldHide}
          </button>
        ) : null}
      </div>
    </section>
  );
}
