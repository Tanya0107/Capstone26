/**
 * FR1 Goals Enrichment Screen form (book Fig 6).
 *
 * Validation mirrors GenerationRequest: subject and gradeLevel must come
 * from the served catalog, goals must say something, difficultyLevel sits
 * in 1 to 5. The subject and grade selects are driven by the catalog
 * rather than by a hardcoded list, so the form cannot offer a combination
 * the route would reject with 422, nor a grade whose standards slice would
 * come back empty.
 *
 * The form is fully controlled by its parent. That is what satisfies NFR7:
 * when a generation times out after several minutes, the values live in the
 * page, not in this component, so the teacher gets their filled in form
 * back instead of a blank one.
 */
"use client";

import { useId, useMemo, useState } from "react";
import type { SubjectOption } from "@/types/models";
import { strings } from "./strings";

export interface GoalsFormValues {
  subject: string;
  gradeLevel: string;
  goals: string;
  topics: string[];
  difficultyLevel: number;
  standardsHint: string;
}

export const emptyGoalsForm: GoalsFormValues = {
  subject: "",
  gradeLevel: "",
  goals: "",
  topics: [],
  difficultyLevel: 3,
  standardsHint: "",
};

export const DIFFICULTY_LEVELS = [1, 2, 3, 4, 5] as const;

export type GoalsFormErrors = Partial<Record<keyof GoalsFormValues, string>>;

/** Mirror of the GenerationRequest constraints, shared with the parent so a
 * submit cannot bypass it. */
export function validateGoalsForm(
  values: GoalsFormValues,
  catalog: SubjectOption[],
): GoalsFormErrors {
  const errors: GoalsFormErrors = {};
  const option = catalog.find((entry) => entry.subject === values.subject);

  if (!values.subject) errors.subject = strings.errorSubjectRequired;
  else if (!option) errors.subject = strings.errorSubjectRequired;

  if (!values.gradeLevel) errors.gradeLevel = strings.errorGradeRequired;
  else if (option && !option.grades.includes(values.gradeLevel)) {
    errors.gradeLevel = strings.errorGradeUnavailable;
  }

  if (!values.goals.trim()) errors.goals = strings.errorGoalsRequired;

  if (
    !Number.isInteger(values.difficultyLevel) ||
    values.difficultyLevel < 1 ||
    values.difficultyLevel > 5
  ) {
    errors.difficultyLevel = strings.errorDifficultyRange;
  }
  return errors;
}

const fieldClass =
  "rounded-card border border-line bg-surface px-3 py-2.5 text-ink " +
  "disabled:opacity-60";
const labelClass = "text-sm font-semibold text-ink";
const hintClass = "text-sm text-ink-muted";

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} role="alert" className="text-sm font-medium text-danger">
      {message}
    </p>
  );
}

export default function GoalsForm({
  values,
  catalog,
  errors,
  submitting,
  onChange,
  onSubmit,
}: {
  values: GoalsFormValues;
  catalog: SubjectOption[];
  errors: GoalsFormErrors;
  submitting: boolean;
  onChange: (next: GoalsFormValues) => void;
  onSubmit: () => void;
}) {
  const ids = useId();
  const [topicDraft, setTopicDraft] = useState("");

  const selected = useMemo(
    () => catalog.find((entry) => entry.subject === values.subject) ?? null,
    [catalog, values.subject],
  );

  const set = <K extends keyof GoalsFormValues>(key: K, value: GoalsFormValues[K]) =>
    onChange({ ...values, [key]: value });

  function changeSubject(subject: string) {
    // Grades differ per subject, so a grade chosen for the previous subject
    // may not exist in the new one. Clearing it is the honest reset.
    const option = catalog.find((entry) => entry.subject === subject);
    const keepGrade = option?.grades.includes(values.gradeLevel) ? values.gradeLevel : "";
    onChange({ ...values, subject, gradeLevel: keepGrade });
  }

  function addTopic() {
    const topic = topicDraft.trim();
    if (!topic || values.topics.includes(topic)) {
      setTopicDraft("");
      return;
    }
    onChange({ ...values, topics: [...values.topics, topic] });
    setTopicDraft("");
  }

  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
      className="flex flex-col gap-6"
      data-testid="goals-form"
    >
      <div className="grid gap-6 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <label className={labelClass} htmlFor={`${ids}-subject`}>
            {strings.subjectLabel}
          </label>
          <select
            id={`${ids}-subject`}
            className={fieldClass}
            value={values.subject}
            disabled={submitting}
            aria-invalid={Boolean(errors.subject)}
            aria-describedby={errors.subject ? `${ids}-subject-error` : undefined}
            onChange={(event) => changeSubject(event.target.value)}
            data-testid="goals-subject"
          >
            <option value="">{strings.subjectPlaceholder}</option>
            {catalog.map((option) => (
              <option key={option.subject} value={option.subject}>
                {option.subject}
              </option>
            ))}
          </select>
          {selected && (
            <p className={hintClass}>
              {selected.subjectType === "quantitative"
                ? strings.subjectTypeQuantitative
                : strings.subjectTypeOpenEnded}
            </p>
          )}
          {selected?.draftCorpus && (
            <p
              className="rounded-card bg-brand-soft px-3 py-2 text-sm text-ink"
              data-testid="goals-draft-corpus"
            >
              {strings.subjectDraftCorpus}
            </p>
          )}
          <FieldError id={`${ids}-subject-error`} message={errors.subject} />
        </div>

        <div className="flex flex-col gap-1.5">
          <label className={labelClass} htmlFor={`${ids}-grade`}>
            {strings.gradeLabel}
          </label>
          <select
            id={`${ids}-grade`}
            className={fieldClass}
            value={values.gradeLevel}
            disabled={submitting || !selected}
            aria-invalid={Boolean(errors.gradeLevel)}
            aria-describedby={errors.gradeLevel ? `${ids}-grade-error` : undefined}
            onChange={(event) => set("gradeLevel", event.target.value)}
            data-testid="goals-grade"
          >
            <option value="">{strings.gradePlaceholder}</option>
            {(selected?.grades ?? []).map((grade) => (
              <option key={grade} value={grade}>
                {grade}
              </option>
            ))}
          </select>
          {!selected && <p className={hintClass}>{strings.gradeNeedsSubject}</p>}
          <FieldError id={`${ids}-grade-error`} message={errors.gradeLevel} />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <label className={labelClass} htmlFor={`${ids}-goals`}>
          {strings.goalsLabel}
        </label>
        <textarea
          id={`${ids}-goals`}
          rows={4}
          className={fieldClass}
          value={values.goals}
          disabled={submitting}
          aria-invalid={Boolean(errors.goals)}
          aria-describedby={`${ids}-goals-hint${errors.goals ? ` ${ids}-goals-error` : ""}`}
          onChange={(event) => set("goals", event.target.value)}
          data-testid="goals-text"
        />
        <p id={`${ids}-goals-hint`} className={hintClass}>
          {strings.goalsHint}
        </p>
        <FieldError id={`${ids}-goals-error`} message={errors.goals} />
      </div>

      <div className="flex flex-col gap-1.5">
        <label className={labelClass} htmlFor={`${ids}-topic-draft`}>
          {strings.topicsLabel}
        </label>
        <div className="flex gap-2">
          <input
            id={`${ids}-topic-draft`}
            className={`${fieldClass} grow`}
            value={topicDraft}
            disabled={submitting}
            aria-describedby={`${ids}-topics-hint`}
            onChange={(event) => setTopicDraft(event.target.value)}
            onKeyDown={(event) => {
              // Enter adds a topic. Without preventDefault it would submit
              // the form and start a multi minute generation by accident.
              if (event.key === "Enter" || event.key === ",") {
                event.preventDefault();
                addTopic();
              }
            }}
            data-testid="goals-topic-input"
          />
          <button
            type="button"
            onClick={addTopic}
            disabled={submitting || !topicDraft.trim()}
            className="rounded-card border border-line px-4 font-medium text-ink-muted hover:border-brand hover:text-brand disabled:opacity-50"
            data-testid="goals-topic-add"
          >
            {strings.topicsAdd}
          </button>
        </div>
        <p id={`${ids}-topics-hint`} className={hintClass}>
          {strings.topicsHint}
        </p>
        {values.topics.length > 0 ? (
          <ul className="flex flex-wrap gap-2" data-testid="goals-topic-list">
            {values.topics.map((topic) => (
              <li
                key={topic}
                className="flex items-center gap-2 rounded-card bg-brand-soft px-3 py-1.5 text-sm text-ink"
              >
                <span>{topic}</span>
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() =>
                    set(
                      "topics",
                      values.topics.filter((entry) => entry !== topic),
                    )
                  }
                  aria-label={`${strings.topicsRemove}: ${topic}`}
                  className="font-bold text-ink-muted hover:text-danger disabled:opacity-50"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className={hintClass}>{strings.topicsEmpty}</p>
        )}
      </div>

      <fieldset className="flex flex-col gap-1.5" disabled={submitting}>
        <legend className={labelClass}>{strings.difficultyLabel}</legend>
        <div className="flex gap-2" role="radiogroup" aria-label={strings.difficultyLabel}>
          {DIFFICULTY_LEVELS.map((level) => {
            const active = values.difficultyLevel === level;
            return (
              <label
                key={level}
                className={`cursor-pointer rounded-card border px-4 py-2 font-semibold ${
                  active
                    ? "border-brand bg-brand text-brand-contrast"
                    : "border-line text-ink-muted hover:border-brand hover:text-brand"
                }`}
              >
                <input
                  type="radio"
                  name={`${ids}-difficulty`}
                  value={level}
                  checked={active}
                  onChange={() => set("difficultyLevel", level)}
                  className="sr-only"
                  data-testid={`goals-difficulty-${level}`}
                />
                {level}
              </label>
            );
          })}
        </div>
        <p className={hintClass}>{strings.difficultyHint}</p>
        <FieldError id={`${ids}-difficulty-error`} message={errors.difficultyLevel} />
      </fieldset>

      <div className="flex flex-col gap-1.5">
        <label className={labelClass} htmlFor={`${ids}-standards`}>
          {strings.standardsHintLabel}{" "}
          <span className="font-normal text-ink-muted">
            ({strings.standardsHintOptional})
          </span>
        </label>
        <input
          id={`${ids}-standards`}
          className={fieldClass}
          value={values.standardsHint}
          disabled={submitting}
          aria-describedby={`${ids}-standards-hint`}
          onChange={(event) => set("standardsHint", event.target.value)}
          data-testid="goals-standards-hint"
        />
        <p id={`${ids}-standards-hint`} className={hintClass}>
          {strings.standardsHintHint}
        </p>
      </div>

      <button
        type="submit"
        disabled={submitting}
        className="self-start rounded-card bg-brand px-6 py-3 font-semibold text-brand-contrast transition-colors hover:bg-brand-strong disabled:opacity-50"
        data-testid="goals-submit"
      >
        {submitting ? strings.submitting : strings.submit}
      </button>
    </form>
  );
}
