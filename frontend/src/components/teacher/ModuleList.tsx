/**
 * The teacher's modules as cards (FR5, Q13).
 *
 * Deliberately shows no quality scores. They are per draft diagnostics
 * (R1) and a number in a list, away from the reference unit it was
 * measured against and from the warning that the reference is itself an
 * unvalidated draft, would read as a grade for the unit. The critic
 * verdict is shown instead, because a verdict is a judgement rather than
 * a metric.
 */
"use client";

import Link from "next/link";
import { strings } from "@/components/teacher/strings";
import type { ModuleSummary } from "@/lib/firebase/modules";

const dateFormat = new Intl.DateTimeFormat("he-IL", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

function Badge({ tone, children }: { tone: "draft" | "published" | "ok" | "warn"; children: React.ReactNode }) {
  const tones = {
    draft: "bg-surface-sunken text-ink-muted",
    published: "bg-brand-soft text-brand-strong",
    ok: "bg-ok/15 text-ink",
    warn: "bg-warn/20 text-ink",
  } as const;
  return (
    <span className={`rounded-card px-2 py-0.5 text-xs font-semibold ${tones[tone]}`}>
      {children}
    </span>
  );
}

export default function ModuleList({ modules }: { modules: ModuleSummary[] }) {
  return (
    <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" data-testid="module-list">
      {modules.map((module) => (
        <li
          key={module.moduleKey}
          className="flex min-w-0 flex-col gap-3 rounded-card border border-line bg-surface p-4 shadow-card"
          data-testid={`module-card-${module.moduleKey}`}
        >
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={module.status === "published" ? "published" : "draft"}>
              {module.status === "published"
                ? strings.moduleStatusPublished
                : strings.moduleStatusDraft}
            </Badge>
            {module.criticApproved === null ? (
              <Badge tone="warn">{strings.dashCriticUnknown}</Badge>
            ) : module.criticApproved ? (
              <Badge tone="ok">{strings.dashCriticApproved}</Badge>
            ) : (
              <Badge tone="warn">{strings.dashCriticNotApproved}</Badge>
            )}
          </div>

          <h2 className="font-display text-base font-bold text-ink">
            <Link
              href={`/teacher/review/${module.moduleKey}`}
              className="underline-offset-2 hover:underline"
              data-testid={`module-open-${module.moduleKey}`}
            >
              {module.title || strings.dashOpen}
            </Link>
          </h2>

          <dl className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-ink-muted">
            <div className="flex gap-1.5">
              <dt>{strings.moduleSubject}:</dt>
              <dd className="font-semibold text-ink">{module.subject}</dd>
            </div>
            <div className="flex gap-1.5">
              <dt>{strings.moduleGrade}:</dt>
              <dd className="font-semibold text-ink">{module.gradeLevel}</dd>
            </div>
            <div className="flex gap-1.5">
              <dt>{strings.moduleDifficulty}:</dt>
              <dd className="font-semibold text-ink">{module.difficultyLevel}</dd>
            </div>
          </dl>

          <p className="text-sm text-ink-muted">
            {module.lessonCount} {strings.dashLessons}
            {", "}
            {module.exerciseCount} {strings.dashExercises}
            {module.status === "published" && module.assignedCount > 0 ? (
              <>
                {". "}
                {strings.dashAssignedTo} {module.assignedCount} {strings.dashStudents}
              </>
            ) : null}
          </p>

          <p className="mt-auto text-xs text-ink-muted" data-testid={`module-created-${module.moduleKey}`}>
            {module.createdAt
              ? `${strings.dashCreatedAt} ${dateFormat.format(module.createdAt)}`
              : strings.dashCreatedPending}
          </p>
        </li>
      ))}
    </ul>
  );
}
