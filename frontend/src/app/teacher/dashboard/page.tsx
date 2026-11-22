/**
 * Teacher home: the modules I created, drafts first in time order, and the
 * entry point to creating a new one (FR5).
 *
 * This screen is not in BUILD_GUIDE Phase 4. It was added because no step
 * built it and its absence broke two things: the Review Dashboard is
 * reachable only by a moduleKey that only the Goals screen knows, for the
 * one run that just finished, so a teacher could never return to their own
 * work; and a generation that the server completes after the browser gave
 * up left a draft nobody could reach. Recorded as Q13 and D20.
 */
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import ModuleList from "@/components/teacher/ModuleList";
import { strings } from "@/components/teacher/strings";
import { listenToMyModules, type ModuleSummary } from "@/lib/firebase/modules";
import { useAuth } from "@/lib/hooks/useAuth";

type Filter = "all" | "draft" | "published";

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: strings.dashFilterAll },
  { key: "draft", label: strings.dashFilterDraft },
  { key: "published", label: strings.dashFilterPublished },
];

export default function TeacherDashboard() {
  const { user, loading: authLoading } = useAuth();
  const [modules, setModules] = useState<ModuleSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  // Bumping this resubscribes, which is the only retry a listener has.
  const [attempt, setAttempt] = useState(0);

  const subscribe = useCallback(() => {
    if (!user) return undefined;
    setError(null);
    return listenToMyModules(
      user.uid,
      (next) => setModules(next),
      (err) => {
        setError(String(err));
        setModules([]);
      },
    );
  }, [user]);

  useEffect(() => {
    if (authLoading || !user) return;
    const unsubscribe = subscribe();
    return unsubscribe;
  }, [authLoading, user, subscribe, attempt]);

  const shown = useMemo(
    () => (modules ?? []).filter((m) => filter === "all" || m.status === filter),
    [modules, filter],
  );
  const counts = useMemo(
    () => ({
      all: (modules ?? []).length,
      draft: (modules ?? []).filter((m) => m.status === "draft").length,
      published: (modules ?? []).filter((m) => m.status === "published").length,
    }),
    [modules],
  );

  return (
    <section className="flex flex-col gap-6 p-6 lg:p-8" data-testid="teacher-dashboard">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="font-display text-2xl font-bold text-ink">{strings.dashTitle}</h1>
          <p className="text-ink-muted">{strings.dashIntro}</p>
        </div>
        <Link
          href="/teacher/create"
          className="rounded-card bg-brand px-4 py-2 font-semibold text-brand-contrast"
          data-testid="dash-create"
        >
          {strings.dashCreate}
        </Link>
      </header>

      {modules === null && !error ? (
        <p className="text-ink-muted" data-testid="dash-loading">
          {strings.dashLoading}
        </p>
      ) : error ? (
        <div className="flex flex-col items-start gap-2" data-testid="dash-error">
          <p role="alert" className="font-semibold text-danger">
            {strings.dashErrorTitle}
          </p>
          <p className="text-sm text-ink-muted">{error}</p>
          <button
            type="button"
            className="rounded-card border border-line px-3 py-1.5 font-semibold"
            onClick={() => {
              setModules(null);
              setAttempt((n) => n + 1);
            }}
            data-testid="dash-retry"
          >
            {strings.dashRetry}
          </button>
        </div>
      ) : counts.all === 0 ? (
        <div className="flex flex-col items-start gap-2" data-testid="dash-empty">
          <p className="font-semibold text-ink">{strings.dashEmptyTitle}</p>
          <p className="text-ink-muted">{strings.dashEmptyBody}</p>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <div role="group" aria-label={strings.dashFilterAll} className="flex flex-wrap gap-2">
              {FILTERS.map(({ key, label }) => (
                <button
                  key={key}
                  type="button"
                  aria-pressed={filter === key}
                  className={`rounded-card px-3 py-1.5 text-sm font-semibold ${
                    filter === key
                      ? "bg-brand-soft text-brand-strong"
                      : "border border-line text-ink-muted"
                  }`}
                  onClick={() => setFilter(key)}
                  data-testid={`dash-filter-${key}`}
                >
                  {label} ({counts[key]})
                </button>
              ))}
            </div>
            <p className="text-sm text-ink-muted" data-testid="dash-count">
              {shown.length} {strings.dashCount}
            </p>
          </div>

          <p className="text-sm text-ink-muted">{strings.dashLiveNote}</p>

          {shown.length === 0 ? (
            <p className="text-ink-muted" data-testid="dash-empty-filtered">
              {strings.dashEmptyFiltered}
            </p>
          ) : (
            <ModuleList modules={shown} />
          )}
        </>
      )}
    </section>
  );
}
