/**
 * Student dashboard (book Fig 8) - FR9: browse & select assigned programs.
 * Live list via listenToAssignments (NFR3) + progress badges (FR13 history).
 *
 * Three listeners rather than one query and a fetch per row: the
 * assignments addressed to this student, the modules published to them, and
 * their own progress. They are joined here by key. That shape is what makes
 * a publish from another browser appear complete, since the module and the
 * assignment arrive on their own listeners within the same moment and the
 * card never has to render half of itself while a getDoc is in flight.
 *
 * A student sees nothing until a teacher publishes, so the empty state is
 * the normal first state of this screen and not an error.
 */
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import ProgressSummary, { type HistoryRow } from "@/components/student/ProgressSummary";
import { strings, subjectLabel } from "@/components/student/strings";
import {
  isRecoverable,
  listenToAssignedModules,
  listenToAssignments,
  listenToMyProgress,
  type AssignedModule,
} from "@/lib/firebase/firestore";
import { useAuth } from "@/lib/hooks/useAuth";
import type { Assignment, StudentProgress } from "@/types/models";

interface Row {
  assignmentKey: string;
  moduleKey: string;
  module: AssignedModule | null;
  submitted: number;
  total: number;
  isCompleted: boolean;
  started: boolean;
}

function AssignmentCard({ row }: { row: Row }) {
  const title = row.module?.title ?? strings.cardMissing;
  const badge = row.isCompleted
    ? strings.cardDone
    : row.started
      ? strings.cardInProgress
      : strings.cardNew;
  const cta = row.isCompleted
    ? strings.cardReview
    : row.started
      ? strings.cardContinue
      : strings.cardStart;

  return (
    <li
      className="flex min-w-0 flex-col gap-4 rounded-card bg-surface p-5 shadow-card"
      data-testid={`assignment-card-${row.assignmentKey}`}
      data-module-key={row.moduleKey}
      data-completed={row.isCompleted}
    >
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
        <h2 className="min-w-0 font-display text-lg font-bold text-ink">{title}</h2>
        <span
          className={`flex-none rounded-card px-2.5 py-1 text-sm font-semibold ${
            row.isCompleted ? "bg-brand-soft text-brand-strong" : "bg-surface-sunken text-ink-muted"
          }`}
          data-testid={`assignment-badge-${row.assignmentKey}`}
        >
          {badge}
        </span>
      </div>

      {row.module?.summary ? (
        <p className="min-w-0 text-ink-muted">{row.module.summary}</p>
      ) : null}

      {row.module ? (
        <dl className="flex min-w-0 flex-wrap gap-x-6 gap-y-2 text-sm">
          <div className="flex min-w-0 gap-1.5">
            <dt className="text-ink-muted">{strings.cardGrade}</dt>
            <dd className="font-semibold text-ink">{row.module.gradeLevel}</dd>
          </div>
          <div className="flex min-w-0 gap-1.5">
            <dt className="text-ink-muted">{subjectLabel(row.module.subject)}</dt>
            <dd className="font-semibold text-ink">
              {`${row.module.lessonCount} ${strings.cardLessons}`}
            </dd>
          </div>
          <div className="flex min-w-0 gap-1.5">
            <dt className="text-ink-muted">{strings.cardExercises}</dt>
            <dd className="font-semibold text-ink">{row.total}</dd>
          </div>
          <div className="flex min-w-0 gap-1.5">
            <dt className="text-ink-muted">{strings.cardProgressLabel}</dt>
            <dd className="font-semibold text-ink" data-testid={`assignment-progress-${row.assignmentKey}`}>
              {`${row.submitted} ${strings.cardProgressOf} ${row.total}`}
            </dd>
          </div>
        </dl>
      ) : null}

      <Link
        href={`/student/workspace/${row.assignmentKey}`}
        className="self-start rounded-card bg-brand px-5 py-2.5 font-semibold text-brand-contrast"
        data-testid={`assignment-open-${row.assignmentKey}`}
      >
        {cta}
      </Link>
    </li>
  );
}

export default function StudentDashboard() {
  const { user, loading: authLoading } = useAuth();
  const [assignments, setAssignments] = useState<Assignment[] | null>(null);
  const [modules, setModules] = useState<AssignedModule[]>([]);
  const [progress, setProgress] = useState<StudentProgress[]>([]);
  const [error, setError] = useState<string | null>(null);
  // Bumping this resubscribes, which is the only retry a listener has.
  const [attempt, setAttempt] = useState(0);

  const subscribe = useCallback(() => {
    if (!user) return undefined;
    setError(null);
    const fail = (err: Error) => {
      // A reconnect is not a failed screen, so it does not replace the list
      // with an error the student would have to dismiss.
      if (isRecoverable(err)) return;
      setError(String(err));
      setAssignments([]);
    };
    const unsubscribers = [
      listenToAssignments(user.uid, setAssignments, fail),
      listenToAssignedModules(user.uid, setModules, fail),
      listenToMyProgress(user.uid, setProgress, fail),
    ];
    return () => unsubscribers.forEach((off) => off());
  }, [user]);

  useEffect(() => {
    if (authLoading || !user) return;
    return subscribe();
  }, [authLoading, user, subscribe, attempt]);

  const rows = useMemo<Row[]>(() => {
    const byModule = new Map(modules.map((m) => [m.moduleKey, m]));
    const byAssignment = new Map(progress.map((p) => [p.assignmentKey, p]));
    return (assignments ?? []).map((assignment) => {
      const module = byModule.get(assignment.moduleKey) ?? null;
      const mine = byAssignment.get(assignment.assignmentId);
      return {
        assignmentKey: assignment.assignmentId,
        moduleKey: assignment.moduleKey,
        module,
        // currentExerciseOrder counts submitted exercises, so it is the
        // progress figure as well as the resume point (Fig 4).
        submitted: mine?.currentExerciseOrder ?? 0,
        total: module?.exerciseCount ?? 0,
        isCompleted: Boolean(mine?.isCompleted),
        started: Boolean(mine),
      };
    });
  }, [assignments, modules, progress]);

  const history = useMemo<HistoryRow[]>(
    () =>
      rows
        .filter((row) => row.started)
        .map((row) => ({
          assignmentKey: row.assignmentKey,
          title: row.module?.title ?? strings.cardMissing,
          submitted: row.submitted,
          total: row.total,
          isCompleted: row.isCompleted,
        })),
    [rows],
  );

  return (
    <section className="flex flex-col gap-8" data-testid="student-dashboard">
      <header className="flex min-w-0 flex-col gap-2">
        <h1 className="font-display text-3xl font-bold text-ink">{strings.dashTitle}</h1>
        <p className="text-lg text-ink-muted">{strings.dashIntro}</p>
      </header>

      {assignments === null && !error ? (
        <p className="text-ink-muted" data-testid="student-dash-loading">
          {strings.dashLoading}
        </p>
      ) : error ? (
        <div className="flex flex-col items-start gap-3" data-testid="student-dash-error">
          <p role="alert" className="font-semibold text-danger">
            {strings.dashErrorTitle}
          </p>
          <p className="text-sm text-ink-muted">{error}</p>
          <button
            type="button"
            className="rounded-card border border-line px-4 py-2 font-semibold"
            onClick={() => {
              setAssignments(null);
              setAttempt((n) => n + 1);
            }}
            data-testid="student-dash-retry"
          >
            {strings.dashRetry}
          </button>
        </div>
      ) : rows.length === 0 ? (
        <div className="flex flex-col items-start gap-2" data-testid="student-dash-empty">
          <p className="font-display text-xl font-bold text-ink">{strings.dashEmptyTitle}</p>
          <p className="text-ink-muted">{strings.dashEmptyBody}</p>
        </div>
      ) : (
        <>
          <p className="text-sm text-ink-muted" data-testid="student-dash-count">
            {`${rows.length} ${strings.dashCount}`}
          </p>
          <ul className="flex min-w-0 flex-col gap-5" data-testid="assignment-list">
            {rows.map((row) => (
              <AssignmentCard key={row.assignmentKey} row={row} />
            ))}
          </ul>
          <ProgressSummary history={history} />
        </>
      )}
    </section>
  );
}
