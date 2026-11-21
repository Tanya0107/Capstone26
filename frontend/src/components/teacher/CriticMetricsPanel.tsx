/**
 * HITL validation panel (Fig 2, teacher interface): critic verdict, issue
 * list, regeneration cycles used, and per draft quality scores.
 *
 * COPY RULE (R1): every number here is a diagnostic for this one draft.
 * None of them is an achieved Phase B result, and the panel says so in the
 * UI rather than only in a comment. A similarity score is also meaningless
 * without the reference it was measured against, so the reference unit and
 * whether it is teacher validated are shown next to the score, never
 * hidden. An unvalidated reference can back a diagnostic but never a
 * reported metric (D17).
 */
import { strings } from "@/components/teacher/strings";
import type { CriticReport, QualityScores } from "@/types/models";

function ScoreRow({
  label,
  value,
  note,
}: {
  label: string;
  value: number | null | undefined;
  note?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-line py-2 last:border-b-0">
      <span className="text-sm text-ink-muted">{label}</span>
      <span className="text-sm font-semibold text-ink" dir="ltr">
        {typeof value === "number" ? value.toFixed(4) : (note ?? strings.scoresPending)}
      </span>
    </div>
  );
}

export default function CriticMetricsPanel({
  criticReport,
  qualityScores,
  latencySeconds,
}: {
  criticReport?: CriticReport | null;
  qualityScores?: QualityScores | null;
  latencySeconds?: number | null;
}) {
  const approved = Boolean(criticReport?.approved);
  const issues = criticReport?.issues ?? [];

  return (
    <aside
      className="flex min-w-0 flex-col gap-5 rounded-card border border-line bg-surface p-5 shadow-card"
      aria-labelledby="critic-panel-heading"
      data-testid="critic-panel"
    >
      <div className="flex flex-col gap-2">
        <h2 id="critic-panel-heading" className="font-display text-lg font-bold text-ink">
          {strings.criticTitle}
        </h2>
        <p
          className={
            "rounded-card px-3 py-2 text-sm font-semibold " +
            (approved ? "bg-ok/15 text-ink" : "bg-warn/20 text-ink")
          }
          data-testid="critic-verdict"
        >
          {approved ? strings.criticApproved : strings.criticNotApproved}
        </p>
        <p className="text-sm text-ink-muted">{strings.criticNeedsYou}</p>
      </div>

      <dl className="flex items-baseline justify-between gap-3">
        <dt className="text-sm text-ink-muted">{strings.criticCycles}</dt>
        <dd className="text-sm font-semibold text-ink" data-testid="critic-cycles">
          {criticReport?.regenerationCyclesUsed ?? 0}
        </dd>
      </dl>

      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold text-ink">{strings.criticIssuesLabel}</h3>
        {issues.length === 0 ? (
          <p className="text-sm text-ink-muted" data-testid="critic-no-issues">
            {strings.criticNoIssues}
          </p>
        ) : (
          <ul className="flex flex-col gap-2" data-testid="critic-issues">
            {issues.map((issue, index) => (
              <li
                key={`${issue.exerciseOrder}-${issue.issueType}-${index}`}
                className="rounded-card bg-surface-sunken p-3 text-sm text-ink"
              >
                <span className="font-semibold">
                  {strings.criticIssueExercise} {issue.exerciseOrder}
                </span>
                <span className="mx-2 text-ink-muted" dir="ltr">
                  {issue.issueType}
                </span>
                <p className="mt-1 text-ink-muted">{issue.detail}</p>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold text-ink">{strings.scoresTitle}</h3>
        <p className="rounded-card bg-surface-sunken p-3 text-sm text-ink-muted">
          {strings.scoresDisclaimer}
        </p>
        <div data-testid="quality-scores">
          <ScoreRow label={strings.scoresRougeL} value={qualityScores?.rougeL} />
          <ScoreRow label={strings.scoresBertScore} value={qualityScores?.bertscoreF1} />
          <ScoreRow
            label={strings.scoresBleu}
            value={qualityScores?.bleu}
            note={strings.scoresBleuOffline}
          />
        </div>
        {qualityScores?.referenceUnit ? (
          <p className="text-sm text-ink-muted" data-testid="scores-reference">
            {strings.scoresReferenceLabel}{" "}
            <span className="font-semibold text-ink" dir="ltr">
              {qualityScores.referenceUnit}
            </span>
            {". "}
            {qualityScores.referenceValidated
              ? strings.scoresReferenceValidated
              : strings.scoresReferenceDraft}
          </p>
        ) : (
          <p className="text-sm text-ink-muted" data-testid="scores-reference">
            {strings.scoresReferenceNone}
          </p>
        )}
      </div>

      {typeof latencySeconds === "number" && (
        <dl className="flex items-baseline justify-between gap-3 border-t border-line pt-3">
          <dt className="text-sm text-ink-muted">{strings.latencyLabel}</dt>
          <dd className="text-sm font-semibold text-ink">
            {Math.round(latencySeconds)} {strings.latencySeconds}
          </dd>
        </dl>
      )}
    </aside>
  );
}
