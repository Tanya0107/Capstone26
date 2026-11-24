/**
 * Goals Enrichment Screen (book Fig 6), FR1.
 *
 * Submit calls lib/api/generation.generateCurriculum behind the staged
 * LoadingIndicator (NFR8), then routes to the Review Dashboard for the new
 * module.
 *
 * NFR7 is the reason the form values live here rather than inside
 * GoalsForm. A generation runs for minutes, and when one times out the
 * teacher must get their filled in form back with a retry, not a blank
 * one. Holding the values in the page means the form can unmount while the
 * request is in flight and still come back intact. retry resubmits the
 * same values without the teacher retyping anything.
 */
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import LoadingIndicator from "@/components/shared/LoadingIndicator";
import GoalsForm, {
  emptyGoalsForm,
  validateGoalsForm,
  type GoalsFormErrors,
  type GoalsFormValues,
} from "@/components/teacher/GoalsForm";
import { strings } from "@/components/teacher/strings";
import {
  GenerationError,
  fetchSubjectCatalog,
  generateCurriculum,
} from "@/lib/api/generation";
import { useAuth } from "@/lib/hooks/useAuth";
import type { GenerationRequest, SubjectOption } from "@/types/models";

type Phase = "editing" | "generating";

interface ErrorView {
  title: string;
  body: string | null;
  retriable: boolean;
}

function describe(error: unknown): ErrorView {
  if (error instanceof GenerationError) {
    switch (error.kind) {
      case "timeout":
        return {
          title: strings.errorTimeoutTitle,
          body: strings.errorTimeoutBody,
          retriable: error.retriable,
        };
      case "forbidden":
        return {
          title: strings.errorForbiddenTitle,
          body: strings.errorForbiddenBody,
          retriable: false,
        };
      case "validation":
        // The route's own detail is the useful text here, since it names
        // the field or the unservable subject.
        return {
          title: strings.errorValidationTitle,
          body: error.detail,
          retriable: false,
        };
      case "network":
        return {
          title: strings.errorNetworkTitle,
          body: strings.errorNetworkBody,
          retriable: true,
        };
      default:
        return {
          title: strings.errorServerTitle,
          body: strings.errorServerBody,
          retriable: error.retriable,
        };
    }
  }
  return { title: strings.errorServerTitle, body: strings.errorServerBody, retriable: true };
}

export default function CreateEnrichmentPage() {
  const { user, schoolKey, idToken, loading } = useAuth();
  const router = useRouter();

  const [values, setValues] = useState<GoalsFormValues>(emptyGoalsForm);
  const [errors, setErrors] = useState<GoalsFormErrors>({});
  const [phase, setPhase] = useState<Phase>("editing");
  const [failure, setFailure] = useState<ErrorView | null>(null);

  const [catalog, setCatalog] = useState<SubjectOption[] | null>(null);
  const [catalogError, setCatalogError] = useState(false);
  const [catalogAttempt, setCatalogAttempt] = useState(0);

  // Abort an in flight generation if the teacher navigates away, so the
  // fetch does not outlive the screen that would handle its result.
  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => () => abortRef.current?.abort(), []);

  useEffect(() => {
    if (!idToken) return;
    let active = true;
    setCatalogError(false);
    fetchSubjectCatalog(idToken)
      .then((result) => {
        if (active) setCatalog(result.subjects);
      })
      .catch((err) => {
        console.error("Failed to load the subject catalog", err);
        if (active) setCatalogError(true);
      });
    return () => {
      active = false;
    };
  }, [idToken, catalogAttempt]);

  const submit = useCallback(
    async (next: GoalsFormValues) => {
      if (!user || !idToken || !schoolKey || !catalog) return;

      const found = validateGoalsForm(next, catalog);
      setErrors(found);
      if (Object.keys(found).length > 0) return;

      const request: GenerationRequest = {
        teacherKey: user.uid,
        schoolKey,
        subject: next.subject,
        goals: next.goals.trim(),
        topics: next.topics,
        gradeLevel: next.gradeLevel,
        difficultyLevel: next.difficultyLevel,
        ...(next.standardsHint.trim()
          ? { standardsHint: next.standardsHint.trim() }
          : {}),
      };

      setFailure(null);
      setPhase("generating");
      const controller = new AbortController();
      abortRef.current = controller;
      try {
        const pkg = await generateCurriculum(request, idToken, controller.signal);
        if (!pkg.moduleKey) {
          // The route always fills moduleKey after persisting, so an absent
          // one means the draft was not saved and there is nothing to review.
          throw new GenerationError("server", { retriable: true });
        }
        router.push(`/teacher/review/${pkg.moduleKey}`);
      } catch (err) {
        if (controller.signal.aborted) return;
        setFailure(describe(err));
        setPhase("editing");
      } finally {
        abortRef.current = null;
      }
    },
    [user, idToken, schoolKey, catalog, router],
  );

  if (loading) return null;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="font-display text-2xl font-bold">{strings.goalsTitle}</h1>
        <p className="text-ink-muted">{strings.goalsIntro}</p>
      </header>

      {failure && (
        <section
          role="alert"
          className="flex flex-col gap-2 rounded-card border border-danger/40 bg-danger/5 p-4"
          data-testid="generation-error"
        >
          <h2 className="font-display font-bold text-danger">{failure.title}</h2>
          {failure.body && <p className="text-sm text-ink">{failure.body}</p>}
          <div className="flex gap-2">
            {failure.retriable && (
              <button
                type="button"
                onClick={() => submit(values)}
                className="rounded-card bg-brand px-4 py-2 font-semibold text-brand-contrast hover:bg-brand-strong"
                data-testid="generation-retry"
              >
                {strings.errorRetry}
              </button>
            )}
            <button
              type="button"
              onClick={() => setFailure(null)}
              className="rounded-card border border-line px-4 py-2 font-medium text-ink-muted hover:border-brand hover:text-brand"
              data-testid="generation-dismiss"
            >
              {strings.errorDismiss}
            </button>
          </div>
        </section>
      )}

      {phase === "generating" ? (
        <LoadingIndicator />
      ) : catalogError ? (
        <section
          role="alert"
          className="flex flex-col items-start gap-3 rounded-card border border-line bg-surface p-4"
          data-testid="catalog-error"
        >
          <p className="font-medium text-ink">{strings.catalogFailed}</p>
          <button
            type="button"
            onClick={() => setCatalogAttempt((attempt) => attempt + 1)}
            className="rounded-card bg-brand px-4 py-2 font-semibold text-brand-contrast hover:bg-brand-strong"
            data-testid="catalog-retry"
          >
            {strings.catalogRetry}
          </button>
        </section>
      ) : catalog === null ? (
        <p role="status" className="text-ink-muted" data-testid="catalog-loading">
          {strings.catalogLoading}
        </p>
      ) : catalog.length === 0 ? (
        <p role="alert" className="text-ink" data-testid="catalog-empty">
          {strings.catalogEmpty}
        </p>
      ) : (
        <GoalsForm
          values={values}
          catalog={catalog}
          errors={errors}
          submitting={false}
          onChange={setValues}
          onSubmit={() => submit(values)}
        />
      )}
    </div>
  );
}
