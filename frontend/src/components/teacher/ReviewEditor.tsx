/**
 * FR5 editor: a lesson per accordion, with edit, append and delete for the
 * lesson prose, the exercises, the scaffold steps and the Socratic hints.
 *
 * Fully controlled by the page, the same way GoalsForm is. The page holds
 * the pristine copy loaded from Firestore so it can diff on save (FR6),
 * and a component holding its own copy of the text would make that diff
 * impossible to compute.
 *
 * The accordion is a details element rather than a hand rolled disclosure,
 * so expand and collapse, the keyboard behaviour and the accessible name
 * all come from the platform instead of from state and key handlers.
 */
"use client";

import { strings } from "@/components/teacher/strings";
import type { ReviewExercise, ReviewLesson } from "@/lib/firebase/review";

const fieldClass =
  "w-full rounded-card border border-line bg-surface px-3 py-2 text-ink disabled:opacity-60";
const labelClass = "text-sm font-semibold text-ink";
const smallButton = "rounded-card border border-line px-2 py-1 text-sm disabled:opacity-60";
const dangerButton =
  "rounded-card border border-danger/40 px-2 py-1 text-sm text-danger disabled:opacity-60";

/** A client side key for a row that has no Firestore id yet. */
function draftKey(): string {
  return `new:${crypto.randomUUID()}`;
}

function emptyExercise(order: number): ReviewExercise {
  return {
    exerciseKey: draftKey(),
    order,
    prompt: "",
    scaffoldSteps: [],
    correctAnswer: "",
    socraticHints: [],
  };
}

/** A list of single line strings, editable in place. */
function StringList({
  legend,
  values,
  disabled,
  addLabel,
  removeLabel,
  testidPrefix,
  placeholder,
  onChange,
}: {
  legend: string;
  values: string[];
  disabled: boolean;
  addLabel: string;
  removeLabel: string;
  testidPrefix: string;
  placeholder?: string;
  onChange: (next: string[]) => void;
}) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className={labelClass}>{legend}</legend>
      {values.map((value, index) => (
        <div key={index} className="flex items-center gap-2">
          <input
            className={`${fieldClass} min-w-0 flex-1`}
            value={value}
            disabled={disabled}
            placeholder={placeholder}
            aria-label={`${legend} ${index + 1}`}
            onChange={(event) => {
              const next = [...values];
              next[index] = event.target.value;
              onChange(next);
            }}
            data-testid={`${testidPrefix}-${index}`}
          />
          <button
            type="button"
            className={dangerButton}
            disabled={disabled}
            onClick={() => onChange(values.filter((_, i) => i !== index))}
            data-testid={`${testidPrefix}-remove-${index}`}
          >
            {removeLabel}
          </button>
        </div>
      ))}
      <button
        type="button"
        className={`${smallButton} self-start`}
        disabled={disabled}
        onClick={() => onChange([...values, ""])}
        data-testid={`${testidPrefix}-add`}
      >
        {addLabel}
      </button>
    </fieldset>
  );
}

function ExerciseCard({
  exercise,
  index,
  flagged,
  disabled,
  onChange,
  onDelete,
}: {
  exercise: ReviewExercise;
  index: number;
  flagged: boolean;
  disabled: boolean;
  onChange: (next: ReviewExercise) => void;
  onDelete: () => void;
}) {
  const set = <K extends keyof ReviewExercise>(key: K, value: ReviewExercise[K]) =>
    onChange({ ...exercise, [key]: value });

  return (
    <li
      className={
        "flex flex-col gap-3 rounded-card border p-4 " +
        (flagged ? "border-warn bg-warn/10" : "border-line bg-surface-sunken")
      }
      data-testid={`review-exercise-${index}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-bold text-ink">
          {strings.exerciseHeading} {exercise.order}
        </h4>
        <button
          type="button"
          className={dangerButton}
          disabled={disabled}
          onClick={() => {
            if (window.confirm(strings.exerciseDeleteConfirm)) onDelete();
          }}
          data-testid={`review-exercise-delete-${index}`}
        >
          {strings.exerciseDelete}
        </button>
      </div>

      {flagged && (
        <p className="text-sm font-medium text-ink" data-testid={`review-exercise-flagged-${index}`}>
          {strings.exerciseFlagged}
        </p>
      )}

      <label className="flex flex-col gap-1.5">
        <span className={labelClass}>{strings.exercisePromptLabel}</span>
        <textarea
          className={fieldClass}
          rows={2}
          value={exercise.prompt}
          disabled={disabled}
          onChange={(event) => set("prompt", event.target.value)}
          data-testid={`review-exercise-prompt-${index}`}
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className={labelClass}>{strings.exerciseAnswerLabel}</span>
        <textarea
          className={fieldClass}
          rows={2}
          value={exercise.correctAnswer}
          disabled={disabled}
          onChange={(event) => set("correctAnswer", event.target.value)}
          data-testid={`review-exercise-answer-${index}`}
        />
        <span className="text-sm text-ink-muted">{strings.exerciseAnswerNote}</span>
      </label>

      {exercise.solutionMissing && (
        <p className="text-sm text-danger" data-testid={`review-exercise-no-solution-${index}`}>
          {strings.exerciseSolutionMissing}
        </p>
      )}

      <StringList
        legend={strings.exerciseScaffoldLabel}
        values={exercise.scaffoldSteps}
        disabled={disabled}
        addLabel={strings.exerciseScaffoldAdd}
        removeLabel={strings.exerciseScaffoldRemove}
        testidPrefix={`review-exercise-${index}-scaffold`}
        onChange={(next) => set("scaffoldSteps", next)}
      />

      <StringList
        legend={strings.exerciseHintsLabel}
        values={exercise.socraticHints.map((hint) => hint.hintText)}
        disabled={disabled}
        addLabel={strings.exerciseHintAdd}
        removeLabel={strings.exerciseHintRemove}
        testidPrefix={`review-exercise-${index}-hint`}
        placeholder={strings.exerciseHintPlaceholder}
        onChange={(next) =>
          // Hint order is the ladder position the tutor climbs, so it is
          // the list position and is renumbered whenever the list changes.
          set(
            "socraticHints",
            next.map((hintText, i) => ({ hintOrder: i + 1, hintText })),
          )
        }
      />
    </li>
  );
}

export default function ReviewEditor({
  lessons,
  flaggedOrders,
  disabled,
  onChange,
}: {
  lessons: ReviewLesson[];
  flaggedOrders: number[];
  disabled: boolean;
  onChange: (next: ReviewLesson[], removedExerciseKeys: string[]) => void;
}) {
  const flagged = new Set(flaggedOrders);

  // Orders stay stable across edits. Critic issues point at an exercise by
  // its order, so renumbering after a delete would repoint every issue at
  // the wrong exercise. A new exercise therefore takes the next unused
  // order in the whole module, not the next index in its lesson.
  const nextOrder =
    lessons.reduce(
      (max, lesson) => lesson.exercises.reduce((m, ex) => Math.max(m, ex.order), max),
      0,
    ) + 1;

  const replaceLesson = (index: number, lesson: ReviewLesson) =>
    onChange(
      lessons.map((current, i) => (i === index ? lesson : current)),
      [],
    );

  if (lessons.length === 0) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm text-ink-muted" data-testid="review-no-lessons">
          {strings.lessonEmpty}
        </p>
        <button
          type="button"
          className={`${smallButton} self-start`}
          disabled={disabled}
          onClick={() =>
            onChange([...lessons, { title: "", objectives: [], hook: "", exercises: [] }], [])
          }
          data-testid="review-lesson-add"
        >
          {strings.lessonAdd}
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4" data-testid="review-editor">
      {lessons.map((lesson, lessonIndex) => (
        <details
          key={lessonIndex}
          open={lessonIndex === 0}
          className="rounded-card border border-line bg-surface shadow-card"
          data-testid={`review-lesson-${lessonIndex}`}
        >
          <summary className="cursor-pointer select-none px-4 py-3 font-display font-bold text-ink">
            {strings.lessonHeading} {lessonIndex + 1}
            {lesson.title ? `: ${lesson.title}` : ""}
          </summary>

          <div className="flex flex-col gap-4 border-t border-line p-4">
            <label className="flex flex-col gap-1.5">
              <span className={labelClass}>{strings.lessonTitleLabel}</span>
              <input
                className={fieldClass}
                value={lesson.title}
                disabled={disabled}
                onChange={(event) =>
                  replaceLesson(lessonIndex, { ...lesson, title: event.target.value })
                }
                data-testid={`review-lesson-title-${lessonIndex}`}
              />
            </label>

            <label className="flex flex-col gap-1.5">
              <span className={labelClass}>{strings.lessonHookLabel}</span>
              <textarea
                className={fieldClass}
                rows={2}
                value={lesson.hook}
                disabled={disabled}
                onChange={(event) =>
                  replaceLesson(lessonIndex, { ...lesson, hook: event.target.value })
                }
                data-testid={`review-lesson-hook-${lessonIndex}`}
              />
            </label>

            <StringList
              legend={strings.lessonObjectivesLabel}
              values={lesson.objectives}
              disabled={disabled}
              addLabel={strings.lessonObjectiveAdd}
              removeLabel={strings.lessonObjectiveRemove}
              testidPrefix={`review-lesson-${lessonIndex}-objective`}
              onChange={(next) => replaceLesson(lessonIndex, { ...lesson, objectives: next })}
            />

            <ul className="flex flex-col gap-3">
              {lesson.exercises.map((exercise, exerciseIndex) => (
                <ExerciseCard
                  key={exercise.exerciseKey}
                  exercise={exercise}
                  index={exercise.order}
                  flagged={flagged.has(exercise.order)}
                  disabled={disabled}
                  onChange={(next) =>
                    replaceLesson(lessonIndex, {
                      ...lesson,
                      exercises: lesson.exercises.map((current, i) =>
                        i === exerciseIndex ? next : current,
                      ),
                    })
                  }
                  onDelete={() =>
                    onChange(
                      lessons.map((current, i) =>
                        i === lessonIndex
                          ? {
                              ...current,
                              exercises: current.exercises.filter((_, j) => j !== exerciseIndex),
                            }
                          : current,
                      ),
                      [exercise.exerciseKey],
                    )
                  }
                />
              ))}
            </ul>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className={smallButton}
                disabled={disabled}
                onClick={() =>
                  replaceLesson(lessonIndex, {
                    ...lesson,
                    exercises: [...lesson.exercises, emptyExercise(nextOrder)],
                  })
                }
                data-testid={`review-exercise-add-${lessonIndex}`}
              >
                {strings.exerciseAdd}
              </button>
              <button
                type="button"
                className={dangerButton}
                disabled={disabled}
                onClick={() => {
                  if (!window.confirm(strings.lessonDeleteConfirm)) return;
                  onChange(
                    lessons.filter((_, i) => i !== lessonIndex),
                    lesson.exercises.map((exercise) => exercise.exerciseKey),
                  );
                }}
                data-testid={`review-lesson-delete-${lessonIndex}`}
              >
                {strings.lessonDelete}
              </button>
            </div>
          </div>
        </details>
      ))}

      <button
        type="button"
        className={`${smallButton} self-start`}
        disabled={disabled}
        onClick={() =>
          onChange([...lessons, { title: "", objectives: [], hook: "", exercises: [] }], [])
        }
        data-testid="review-lesson-add"
      >
        {strings.lessonAdd}
      </button>
    </div>
  );
}
