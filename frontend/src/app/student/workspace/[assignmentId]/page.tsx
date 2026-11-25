/**
 * Student workspace (book Fig 9 area) - FR10 + FR11.
 * Layout: exercise pane (prompt, scaffold steps, answer input) + SocraticBot
 * sidebar. Telemetry session runs for the visible exercise (Phase 4, Step 4.5).
 * NFR7: answers buffered to localStorage until server ack.
 *
 * The state machine of Fig 4 is one number, currentExerciseOrder, and it
 * counts submitted exercises rather than the one on screen. So it doubles as
 * the resume point and as the gate: a student may look back at anything they
 * have reached and may only move past it by sending an answer. Keeping one
 * number for all three jobs is what keeps the screen and the document in
 * agreement after an offline submission is replayed.
 *
 * Nothing here can show an answer or a Socratic hint. Those live in
 * exerciseSolutions, which this client cannot read at all (R6, D11), so the
 * guarantee is structural rather than a rule this file has to remember.
 *
 * The Socratic sidebar of Step 4.6 is not rendered yet. A child offered a
 * disabled chat box would ask the teacher why the helper is broken, so the
 * pane arrives with the bot.
 */
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import ExerciseCard, { type AnswerState } from "@/components/student/ExerciseCard";
import ProgressSummary from "@/components/student/ProgressSummary";
import { strings, subjectLabel } from "@/components/student/strings";
import {
  isRecoverable,
  listenToAssignment,
  listenToModule,
  listenToModuleExercises,
  listenToProgress,
  upsertProgress,
} from "@/lib/firebase/firestore";
import {
  bufferingAvailable,
  dequeueProgress,
  flushQueue,
  queueProgress,
  readAnswerDraft,
  readQueue,
  writeAnswerDraft,
} from "@/lib/student/answerBuffer";
import { useAuth } from "@/lib/hooks/useAuth";
import { useTelemetry } from "@/lib/hooks/useTelemetry";
import type { Assignment, StoredCurriculumModule, StoredExercise, StudentProgress } from "@/types/models";

type LoadError = "not_found" | "forbidden" | "unknown";

function errorKind(error: Error): LoadError | null {
  if (isRecoverable(error)) return null;
  return (error as { code?: string }).code === "permission-denied" ? "forbidden" : "unknown";
}

export default function WorkspacePage({ params }: { params: { assignmentId: string } }) {
  const assignmentKey = params.assignmentId;
  const { user, loading: authLoading } = useAuth();
  const studentKey = user?.uid ?? "";

  const [assignment, setAssignment] = useState<Assignment | null | undefined>(undefined);
  const [moduleDoc, setModuleDoc] = useState<StoredCurriculumModule | null | undefined>(undefined);
  const [exercises, setExercises] = useState<StoredExercise[] | undefined>(undefined);
  const [progress, setProgress] = useState<StudentProgress | null | undefined>(undefined);
  const [failure, setFailure] = useState<LoadError | null>(null);

  const [viewIndex, setViewIndex] = useState(0);
  const [draft, setDraft] = useState("");
  const [answerError, setAnswerError] = useState<string | null>(null);
  const [justSubmitted, setJustSubmitted] = useState<string | null>(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [revealed, setRevealed] = useState<Record<string, number>>({});

  // Buffering support is read once, because the answer status line must not
  // flicker between two different promises while a child is typing.
  const [buffering, setBuffering] = useState(true);
  useEffect(() => setBuffering(bufferingAvailable()), []);

  const resumed = useRef(false);
  const created = useRef(false);

  const moduleKey = assignment?.moduleKey ?? "";
  const currentOrder = progress?.currentExerciseOrder ?? 0;
  const total = exercises?.length ?? 0;
  const exercise = exercises && exercises.length > 0 ? exercises[Math.min(viewIndex, total - 1)] : null;
  const exerciseKey = exercise?.exerciseId ?? "";

  // ---- Telemetry (Step 4.5, NFR5) ----
  // Accrues active time on the open exercise and stops when it changes. The
  // returned recordHelp is for the tutor send handler in Step 4.6 and is
  // deliberately not called here: a scaffold reveal is not an Ask the tutor
  // click, and hsrcCount has no event type to tell the two apart (D22).
  useTelemetry(assignmentKey, exerciseKey);

  // ---- Listeners (NFR3) ----
  useEffect(() => {
    if (authLoading || !studentKey) return;
    const fail = (error: Error) => {
      const kind = errorKind(error);
      if (kind) setFailure(kind);
    };
    const offAssignment = listenToAssignment(assignmentKey, setAssignment, fail);
    const offProgress = listenToProgress(assignmentKey, studentKey, setProgress, fail);
    return () => {
      offAssignment();
      offProgress();
    };
  }, [authLoading, studentKey, assignmentKey]);

  useEffect(() => {
    if (!moduleKey || !studentKey) return;
    const fail = (error: Error) => {
      const kind = errorKind(error);
      if (kind) setFailure(kind);
    };
    const offModule = listenToModule(moduleKey, setModuleDoc, fail);
    const offExercises = listenToModuleExercises(moduleKey, studentKey, setExercises, fail);
    return () => {
      offModule();
      offExercises();
    };
  }, [moduleKey, studentKey]);

  // ---- First visit creates the progress document ----
  // startedAt then records when the student opened the unit rather than
  // when they first submitted, which is what FR13 history and the Phase 5
  // time on task figures need it to mean.
  useEffect(() => {
    if (created.current || progress !== null || !studentKey || !assignment) return;
    created.current = true;
    void upsertProgress({
      assignmentKey,
      studentKey,
      currentExerciseOrder: 0,
      isCompleted: false,
      markStarted: true,
    }).catch(() => undefined);
  }, [progress, studentKey, assignment, assignmentKey]);

  // ---- Resume where the student stopped, once ----
  useEffect(() => {
    if (resumed.current || !exercises || exercises.length === 0 || progress === undefined) return;
    resumed.current = true;
    setViewIndex(Math.min(progress?.currentExerciseOrder ?? 0, exercises.length - 1));
  }, [exercises, progress]);

  // ---- Drafts follow the visible exercise ----
  useEffect(() => {
    if (!exerciseKey) return;
    setDraft(readAnswerDraft(assignmentKey, exerciseKey));
    setAnswerError(null);
  }, [assignmentKey, exerciseKey]);

  // ---- Replay anything a previous session could not send (NFR7) ----
  const flush = useCallback(async () => {
    const { left } = await flushQueue((entry) =>
      upsertProgress({
        assignmentKey: entry.assignmentKey,
        studentKey: entry.studentKey,
        currentExerciseOrder: entry.currentExerciseOrder,
        isCompleted: entry.isCompleted,
      }),
    );
    setPendingCount(left);
  }, []);

  useEffect(() => {
    if (!studentKey) return;
    setPendingCount(readQueue().length);
    void flush();
    const onOnline = () => void flush();
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [studentKey, flush]);

  const onDraftChange = useCallback(
    (text: string) => {
      setDraft(text);
      setAnswerError(null);
      if (exerciseKey) writeAnswerDraft(assignmentKey, exerciseKey, text);
    },
    [assignmentKey, exerciseKey],
  );

  /**
   * Submit is deliberately not awaited before the screen moves on. Offline
   * the Firestore promise does not settle at all, so a handler that waited
   * would freeze the workspace on the one occasion NFR7 exists for. The
   * durable record is the queue entry written first, and the acknowledgement
   * is what removes it.
   */
  const onSubmit = useCallback(() => {
    if (!exercise || !studentKey) return;
    if (draft.trim().length === 0) {
      setAnswerError(strings.answerEmpty);
      return;
    }
    const reached = Math.max(currentOrder, viewIndex + 1);
    const isCompleted = total > 0 && reached >= total;
    const entry = {
      assignmentKey,
      studentKey,
      currentExerciseOrder: reached,
      isCompleted,
    };
    setPendingCount(queueProgress(entry).length);
    setJustSubmitted(exercise.exerciseId ?? "");
    upsertProgress({ ...entry, markStarted: progress === null })
      .then(() => {
        // The server ack, and the only thing that clears the queue entry.
        setPendingCount(dequeueProgress(entry).length);
      })
      .catch(() => {
        // Left queued on purpose. The next flush or the online event retries.
        // Offline this promise does not settle at all, so neither branch runs
        // and the entry simply waits.
        setPendingCount(readQueue().length);
      });
    if (viewIndex + 1 < total) setViewIndex(viewIndex + 1);
  }, [exercise, studentKey, draft, currentOrder, viewIndex, total, assignmentKey, progress]);

  const revealStep = useCallback(() => {
    if (!exerciseKey) return;
    setRevealed((shown) => ({ ...shown, [exerciseKey]: (shown[exerciseKey] ?? 0) + 1 }));
  }, [exerciseKey]);

  const collapseSteps = useCallback(() => {
    if (!exerciseKey) return;
    setRevealed((shown) => ({ ...shown, [exerciseKey]: 0 }));
  }, [exerciseKey]);

  const lessonTitle = useMemo(() => {
    if (!moduleDoc || !exerciseKey) return "";
    const lessons = Array.isArray(moduleDoc.lessons) ? moduleDoc.lessons : [];
    const owner = lessons.find((lesson) => (lesson.exerciseKeys ?? []).includes(exerciseKey));
    return owner?.title ?? "";
  }, [moduleDoc, exerciseKey]);

  const answerState: AnswerState =
    pendingCount > 0 && justSubmitted === exerciseKey
      ? "pending"
      : justSubmitted === exerciseKey || viewIndex < currentOrder
        ? "submitted"
        : "draft";

  // ---- Load and permission states ----
  if (authLoading || assignment === undefined) {
    return (
      <p className="text-ink-muted" data-testid="workspace-loading">
        {strings.wsLoading}
      </p>
    );
  }

  if (failure || assignment === null || (assignment && !assignment.assignedTo.includes(studentKey))) {
    const kind: LoadError =
      failure === "forbidden" || (assignment && !assignment.assignedTo.includes(studentKey))
        ? "forbidden"
        : assignment === null
          ? "not_found"
          : (failure ?? "unknown");
    const copy = {
      not_found: [strings.wsNotFoundTitle, strings.wsNotFoundBody],
      forbidden: [strings.wsForbiddenTitle, strings.wsForbiddenBody],
      unknown: [strings.wsErrorTitle, strings.wsNotFoundBody],
    }[kind];
    return (
      <section className="flex flex-col items-start gap-3" data-testid={`workspace-${kind}`}>
        <h1 role="alert" className="font-display text-2xl font-bold text-danger">
          {copy[0]}
        </h1>
        <p className="text-ink-muted">{copy[1]}</p>
        <Link
          href="/student/dashboard"
          className="rounded-card border border-line px-4 py-2 font-semibold"
          data-testid="workspace-back"
        >
          {strings.wsBackToList}
        </Link>
      </section>
    );
  }

  if (exercises === undefined || moduleDoc === undefined) {
    return (
      <p className="text-ink-muted" data-testid="workspace-loading">
        {strings.wsLoading}
      </p>
    );
  }

  if (!exercise) {
    return (
      <section className="flex flex-col items-start gap-3" data-testid="workspace-empty">
        <h1 className="font-display text-2xl font-bold text-ink">{strings.wsEmptyTitle}</h1>
        <p className="text-ink-muted">{strings.wsEmptyBody}</p>
        <Link
          href="/student/dashboard"
          className="rounded-card border border-line px-4 py-2 font-semibold"
          data-testid="workspace-back"
        >
          {strings.wsBackToList}
        </Link>
      </section>
    );
  }

  const canGoNext = viewIndex + 1 < total && viewIndex + 1 <= currentOrder;

  return (
    <section className="flex min-w-0 flex-col gap-6" data-testid="workspace">
      <header className="flex min-w-0 flex-col gap-2">
        <Link
          href="/student/dashboard"
          className="self-start text-sm font-semibold text-brand-strong"
          data-testid="workspace-back"
        >
          {strings.wsBackToList}
        </Link>
        <h1 className="min-w-0 font-display text-2xl font-bold text-ink" data-testid="workspace-title">
          {moduleDoc?.title ?? ""}
        </h1>
        <p className="text-ink-muted">
          {[
            moduleDoc?.subject ? subjectLabel(moduleDoc.subject) : "",
            moduleDoc?.gradeLevel ? `${strings.cardGrade} ${moduleDoc.gradeLevel}` : "",
            lessonTitle ? `${strings.wsLessonLabel}: ${lessonTitle}` : "",
          ]
            .filter(Boolean)
            .join(" | ")}
        </p>
      </header>

      <nav aria-label={strings.wsJumpTo} className="flex min-w-0 flex-wrap items-center gap-2">
        {exercises.map((item, index) => {
          const reachable = index <= currentOrder;
          const active = index === viewIndex;
          return (
            <button
              key={item.exerciseId ?? index}
              type="button"
              disabled={!reachable}
              aria-current={active ? "step" : undefined}
              onClick={() => setViewIndex(index)}
              className={`h-9 w-9 rounded-full text-sm font-bold transition-colors ${
                active
                  ? "bg-brand text-brand-contrast"
                  : reachable
                    ? "bg-brand-soft text-brand-strong"
                    : "border border-line text-ink-muted opacity-50"
              }`}
              data-testid={`exercise-step-${index + 1}`}
            >
              {index + 1}
            </button>
          );
        })}
      </nav>

      {pendingCount > 0 ? (
        <p role="status" className="text-sm font-semibold text-warn" data-testid="pending-banner">
          {pendingCount === 1
            ? strings.answerPendingOne
            : `${pendingCount} ${strings.answerPendingMany}`}
        </p>
      ) : null}

      <ExerciseCard
        exercise={exercise}
        position={Math.min(viewIndex, total - 1) + 1}
        total={total}
        draft={draft}
        onDraftChange={onDraftChange}
        onSubmit={onSubmit}
        state={answerState}
        bufferingOn={buffering}
        error={answerError}
        revealedSteps={revealed[exerciseKey] ?? 0}
        onRevealStep={revealStep}
        onCollapseSteps={collapseSteps}
      />

      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          disabled={viewIndex === 0}
          onClick={() => setViewIndex(viewIndex - 1)}
          className="rounded-card border border-line px-4 py-2 font-semibold text-ink disabled:opacity-40"
          data-testid="exercise-prev"
        >
          {strings.wsPrev}
        </button>
        <div className="flex min-w-0 flex-col items-end gap-1">
          <button
            type="button"
            disabled={!canGoNext}
            onClick={() => setViewIndex(viewIndex + 1)}
            className="rounded-card border border-line px-4 py-2 font-semibold text-ink disabled:opacity-40"
            data-testid="exercise-next"
          >
            {strings.wsNext}
          </button>
          {!canGoNext && viewIndex + 1 < total ? (
            <p className="text-sm text-ink-muted" data-testid="exercise-next-locked">
              {strings.wsNextLocked}
            </p>
          ) : null}
        </div>
      </div>

      <ProgressSummary
        unit={{
          submitted: Math.min(currentOrder, total),
          total,
          isCompleted: Boolean(progress?.isCompleted),
        }}
      />
    </section>
  );
}
