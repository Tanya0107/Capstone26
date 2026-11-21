/**
 * Review Dashboard (book Fig 7), FR5, FR6 and FR7.
 *
 * Holds the whole editable module, plus the pristine copy it was loaded
 * with. The pristine copy is the point: FR6 files what the teacher changed
 * as original and edited pairs, and that diff cannot be computed by a
 * component that owns its own copy of the text.
 *
 * Saving is two steps that must not be confused with each other. The
 * content write to Firestore is the save the teacher asked for. Filing the
 * diffs to the memory bank is a side effect that improves later
 * generations, so a failure there is reported but never presented as a
 * failed save.
 */
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import CriticMetricsPanel from "@/components/teacher/CriticMetricsPanel";
import PublishModal from "@/components/teacher/PublishModal";
import ReviewEditor from "@/components/teacher/ReviewEditor";
import { strings } from "@/components/teacher/strings";
import { postTeacherEdits, type EditDiff } from "@/lib/api/feedback";
import {
  fetchModuleForReview,
  listSchoolStudents,
  publishModule,
  ReviewLoadError,
  saveModuleEdits,
  type ReviewLesson,
  type ReviewModule,
} from "@/lib/firebase/review";
import { useAuth } from "@/lib/hooks/useAuth";
import type { User } from "@/types/models";

type Phase = "loading" | "ready" | "saving" | "failed";

/**
 * A list of short strings is diffed as one block rather than row by row.
 * Reordering three objectives would otherwise file three unrelated edits,
 * none of which describes what the teacher actually did.
 */
function blockOf(values: string[]): string {
  return values.map((value) => value.trim()).filter(Boolean).join("\n");
}

/**
 * What changed, as original and edited pairs for the memory bank (FR6).
 *
 * Appends and deletions are deliberately not filed. The stored body is an
 * "instead of X, the teacher preferred Y" pair, so a pair with one empty
 * side is not a preference, and the cosine distance against an empty
 * string would not mean anything either.
 */
function collectDiffs(pristine: ReviewLesson[], current: ReviewLesson[]): EditDiff[] {
  const diffs: EditDiff[] = [];
  const push = (label: string, before: string, after: string) => {
    const a = before.trim();
    const b = after.trim();
    if (!a || !b || a === b) return;
    diffs.push({ label, originalText: a, editedText: b });
  };

  const byKey = new Map<string, { lesson: ReviewLesson; order: number }>();
  pristine.forEach((lesson) =>
    lesson.exercises.forEach((exercise) =>
      byKey.set(exercise.exerciseKey, { lesson, order: exercise.order }),
    ),
  );

  current.forEach((lesson, index) => {
    const before = pristine[index];
    if (before) {
      const where = `${strings.lessonHeading} ${index + 1}`;
      push(`${where} ${strings.lessonTitleLabel}`, before.title, lesson.title);
      push(`${where} ${strings.lessonHookLabel}`, before.hook, lesson.hook);
      push(
        `${where} ${strings.lessonObjectivesLabel}`,
        blockOf(before.objectives),
        blockOf(lesson.objectives),
      );
    }
    lesson.exercises.forEach((exercise) => {
      const previous = pristine
        .flatMap((l) => l.exercises)
        .find((e) => e.exerciseKey === exercise.exerciseKey);
      if (!previous) return;
      const where = `${strings.exerciseHeading} ${exercise.order}`;
      push(`${where} ${strings.exercisePromptLabel}`, previous.prompt, exercise.prompt);
      push(`${where} ${strings.exerciseAnswerLabel}`, previous.correctAnswer, exercise.correctAnswer);
      push(
        `${where} ${strings.exerciseScaffoldLabel}`,
        blockOf(previous.scaffoldSteps),
        blockOf(exercise.scaffoldSteps),
      );
      push(
        `${where} ${strings.exerciseHintsLabel}`,
        blockOf(previous.socraticHints.map((h) => h.hintText)),
        blockOf(exercise.socraticHints.map((h) => h.hintText)),
      );
    });
  });
  return diffs;
}

export default function ReviewDashboardPage({ params }: { params: { moduleId: string } }) {
  const moduleKey = params.moduleId;
  const { user, schoolKey, idToken, loading: authLoading } = useAuth();

  const [loaded, setLoaded] = useState<ReviewModule | null>(null);
  const [pristine, setPristine] = useState<ReviewLesson[]>([]);
  const [lessons, setLessons] = useState<ReviewLesson[]>([]);
  const [removed, setRemoved] = useState<string[]>([]);
  const [phase, setPhase] = useState<Phase>("loading");
  const [loadError, setLoadError] = useState<ReviewLoadError | null>(null);
  const [saveFailure, setSaveFailure] = useState<string | null>(null);
  const [saveNotice, setSaveNotice] = useState<string | null>(null);

  const [publishOpen, setPublishOpen] = useState(false);
  const [students, setStudents] = useState<User[]>([]);
  const [studentsLoading, setStudentsLoading] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [publishFailure, setPublishFailure] = useState<string | null>(null);
  const [publishNotice, setPublishNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setPhase("loading");
    setLoadError(null);
    try {
      const result = await fetchModuleForReview(moduleKey);
      setLoaded(result);
      setPristine(structuredClone(result.lessons));
      setLessons(structuredClone(result.lessons));
      setRemoved([]);
      setPhase("ready");
    } catch (err) {
      setLoadError(
        err instanceof ReviewLoadError ? err : new ReviewLoadError(String(err), "unknown"),
      );
      setPhase("failed");
    }
  }, [moduleKey]);

  useEffect(() => {
    if (authLoading || !user) return;
    void load();
  }, [authLoading, user, load]);

  const diffs = useMemo(() => collectDiffs(pristine, lessons), [pristine, lessons]);
  const structureChanged = useMemo(
    () => JSON.stringify(pristine) !== JSON.stringify(lessons) || removed.length > 0,
    [pristine, lessons, removed],
  );
  const flaggedOrders = useMemo(
    () => (loaded?.module.criticReport?.issues ?? []).map((issue) => issue.exerciseOrder),
    [loaded],
  );

  function applyEditorChange(next: ReviewLesson[], removedKeys: string[]) {
    setLessons(next);
    if (removedKeys.length > 0) {
      setRemoved((current) => [...current, ...removedKeys]);
    }
    setSaveNotice(null);
  }

  async function save() {
    if (!user || !idToken || !structureChanged) return;
    setPhase("saving");
    setSaveFailure(null);
    setSaveNotice(null);
    try {
      await saveModuleEdits(moduleKey, lessons, removed);
    } catch (err) {
      setSaveFailure(String(err));
      setPhase("ready");
      return;
    }

    // The content is saved from here on. Anything below affects later
    // generations only, so it can never turn this into a failed save.
    let notice: string = strings.saveSuccess;
    if (diffs.length > 0) {
      const outcomes = await postTeacherEdits(user.uid, moduleKey, idToken, diffs);
      const stored = outcomes.filter((o) => o.stored).length;
      const failed = outcomes.filter((o) => o.failed).length;
      if (failed > 0) notice = strings.feedbackPartlyFailed;
      else if (stored === 1) notice = `${strings.saveSuccess}. ${strings.feedbackStoredOne}`;
      else if (stored > 1) {
        notice = `${strings.saveSuccess}. ${stored} ${strings.feedbackStoredMany}`;
      } else notice = strings.feedbackNoneStored;
    }
    setSaveNotice(notice);
    // Reloading is what makes the new ids real: an appended exercise has a
    // client side key until the write gives it a Firestore one, and the
    // next diff has to be measured against what is now stored.
    await load();
    setSaveNotice(notice);
  }

  async function openPublish() {
    setPublishFailure(null);
    setPublishOpen(true);
    if (!schoolKey) return;
    setStudentsLoading(true);
    try {
      setStudents(await listSchoolStudents(schoolKey));
    } catch (err) {
      setPublishFailure(String(err));
    } finally {
      setStudentsLoading(false);
    }
  }

  async function confirmPublish(studentKeys: string[]) {
    if (!user) return;
    setPublishing(true);
    setPublishFailure(null);
    try {
      const exerciseKeys = lessons
        .flatMap((lesson) => lesson.exercises.map((exercise) => exercise.exerciseKey))
        .filter((key) => !key.startsWith("new:"));
      await publishModule(moduleKey, user.uid, studentKeys, exerciseKeys);
      setPublishOpen(false);
      setPublishNotice(`${strings.publishSuccess}. ${strings.publishedTo}: ${studentKeys.length}`);
      await load();
    } catch (err) {
      setPublishFailure(String(err));
    } finally {
      setPublishing(false);
    }
  }

  if (phase === "loading" || authLoading) {
    return (
      <p className="p-8 text-ink-muted" data-testid="review-loading">
        {strings.reviewLoading}
      </p>
    );
  }

  if (phase === "failed" && loadError) {
    const notFound = loadError.kind === "not_found";
    return (
      <section className="flex flex-col items-start gap-3 p-8" data-testid="review-load-error">
        <h1 className="font-display text-xl font-bold text-ink">
          {notFound ? strings.reviewNotFoundTitle : strings.reviewForbiddenTitle}
        </h1>
        <p className="text-ink-muted">
          {notFound ? strings.reviewNotFoundBody : strings.reviewForbiddenBody}
        </p>
        <Link href="/teacher/create" className="font-semibold text-brand underline">
          {strings.reviewBackToCreate}
        </Link>
      </section>
    );
  }

  const moduleDoc = loaded!.module;
  const busy = phase === "saving";
  const published = moduleDoc.status === "published";

  return (
    <section className="flex flex-col gap-6 p-6 lg:p-8" data-testid="review-page">
      <header className="flex flex-col gap-2">
        <h1 className="font-display text-2xl font-bold text-ink" data-testid="review-module-title">
          {moduleDoc.title}
        </h1>
        <p className="text-ink-muted">{strings.reviewIntro}</p>
        <dl className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-ink-muted">
          <div className="flex gap-1.5">
            <dt>{strings.moduleSubject}:</dt>
            <dd className="font-semibold text-ink">{moduleDoc.subject}</dd>
          </div>
          <div className="flex gap-1.5">
            <dt>{strings.moduleGrade}:</dt>
            <dd className="font-semibold text-ink">{moduleDoc.gradeLevel}</dd>
          </div>
          <div className="flex gap-1.5">
            <dt>{strings.moduleDifficulty}:</dt>
            <dd className="font-semibold text-ink">{moduleDoc.difficultyLevel}</dd>
          </div>
          <div className="flex gap-1.5">
            <dt>{strings.moduleStatusLabel}:</dt>
            <dd className="font-semibold text-ink" data-testid="review-module-status">
              {published ? strings.moduleStatusPublished : strings.moduleStatusDraft}
            </dd>
          </div>
        </dl>
      </header>

      {moduleDoc.summary && (
        <section className="rounded-card border border-line bg-surface p-4">
          <h2 className="text-sm font-semibold text-ink">{strings.moduleSummaryLabel}</h2>
          <p className="mt-1 text-ink-muted">{moduleDoc.summary}</p>
        </section>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        {/* min-w-0 because a grid item will not shrink below its content
            width otherwise, and the fields inside have an intrinsic one. */}
        <div className="flex min-w-0 flex-col gap-4">
          <h2 className="font-display text-lg font-bold text-ink">{strings.lessonsLabel}</h2>
          <ReviewEditor
            lessons={lessons}
            flaggedOrders={flaggedOrders}
            disabled={busy}
            onChange={applyEditorChange}
          />

          {moduleDoc.weeklySequence.length > 0 && (
            <section className="rounded-card border border-line bg-surface p-4">
              <h2 className="text-sm font-semibold text-ink">{strings.weeklySequenceLabel}</h2>
              <ol className="mt-2 flex list-decimal flex-col gap-1 ps-5 text-ink-muted">
                {moduleDoc.weeklySequence.map((week, index) => (
                  <li key={index}>{week}</li>
                ))}
              </ol>
            </section>
          )}

          {moduleDoc.assessment && (
            <section className="rounded-card border border-line bg-surface p-4">
              <h2 className="text-sm font-semibold text-ink">{strings.assessmentLabel}</h2>
              <h3 className="mt-2 text-sm font-semibold text-ink">{strings.assessmentRubric}</h3>
              <p className="text-ink-muted">{moduleDoc.assessment.rubric}</p>
              <h3 className="mt-2 text-sm font-semibold text-ink">
                {strings.assessmentDiagnostics}
              </h3>
              <ul className="flex list-disc flex-col gap-1 ps-5 text-ink-muted">
                {moduleDoc.assessment.diagnostics.map((item, index) => (
                  <li key={index}>{item}</li>
                ))}
              </ul>
              <h3 className="mt-2 text-sm font-semibold text-ink">
                {strings.assessmentExitTickets}
              </h3>
              <ul className="flex list-disc flex-col gap-1 ps-5 text-ink-muted">
                {moduleDoc.assessment.exitTickets.map((item, index) => (
                  <li key={index}>{item}</li>
                ))}
              </ul>
            </section>
          )}
        </div>

        <CriticMetricsPanel
          criticReport={moduleDoc.criticReport}
          qualityScores={moduleDoc.qualityScores}
          latencySeconds={moduleDoc.generationLatencySeconds}
        />
      </div>

      <footer className="sticky bottom-0 flex flex-wrap items-center gap-3 border-t border-line bg-surface/95 py-3 backdrop-blur">
        <button
          type="button"
          className="rounded-card bg-brand px-4 py-2 font-semibold text-brand-contrast disabled:opacity-60"
          disabled={busy || !structureChanged}
          onClick={() => void save()}
          data-testid="review-save"
        >
          {busy ? strings.saving : strings.saveButton}
        </button>
        <button
          type="button"
          className="rounded-card border border-line px-4 py-2 font-semibold disabled:opacity-60"
          disabled={busy}
          onClick={() => void openPublish()}
          data-testid="review-publish-open"
        >
          {strings.publishButton}
        </button>
        {!structureChanged && !saveNotice && (
          <span className="text-sm text-ink-muted">{strings.saveNoChanges}</span>
        )}
        {saveNotice && (
          <span role="status" className="text-sm font-medium text-ink" data-testid="review-save-notice">
            {saveNotice}
          </span>
        )}
        {publishNotice && (
          <span role="status" className="text-sm font-medium text-ink" data-testid="review-publish-notice">
            {publishNotice}
          </span>
        )}
        {saveFailure && (
          <span role="alert" className="text-sm font-medium text-danger" data-testid="review-save-failure">
            {strings.saveFailedTitle}: {saveFailure}
          </span>
        )}
      </footer>

      <PublishModal
        open={publishOpen}
        students={students}
        loading={studentsLoading}
        publishing={publishing}
        failure={publishFailure}
        unsavedChanges={structureChanged}
        alreadyPublished={published}
        initiallySelected={moduleDoc.assignedStudentKeys ?? []}
        onClose={() => setPublishOpen(false)}
        onConfirm={(keys) => void confirmPublish(keys)}
      />
    </section>
  );
}
