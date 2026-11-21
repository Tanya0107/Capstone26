/**
 * FR7: choose a distribution list (students of my school) and create the
 * assignment.
 *
 * Uses the native dialog element so focus trapping, Escape and the
 * backdrop come from the platform rather than from hand written key
 * handlers. showModal has to be called from an effect because React
 * renders the element before it can be opened.
 */
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { strings } from "@/components/teacher/strings";
import type { User } from "@/types/models";

export default function PublishModal({
  open,
  students,
  loading,
  publishing,
  failure,
  unsavedChanges,
  alreadyPublished,
  initiallySelected,
  onClose,
  onConfirm,
}: {
  open: boolean;
  students: User[];
  loading: boolean;
  publishing: boolean;
  failure: string | null;
  unsavedChanges: boolean;
  alreadyPublished: boolean;
  initiallySelected: string[];
  onClose: () => void;
  onConfirm: (studentKeys: string[]) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [selected, setSelected] = useState<string[]>(initiallySelected);
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  // Reopening starts from whoever the module is published to now, so a
  // second publish edits the existing audience rather than starting blank.
  useEffect(() => {
    if (open) {
      setSelected(initiallySelected);
      setTouched(false);
    }
  }, [open, initiallySelected]);

  const allKeys = useMemo(() => students.map((s) => s.userId), [students]);
  const invalid = touched && selected.length === 0;

  function toggle(key: string) {
    setTouched(true);
    setSelected((current) =>
      current.includes(key) ? current.filter((k) => k !== key) : [...current, key],
    );
  }

  return (
    <dialog
      ref={ref}
      // A dialog closed by Escape or the backdrop must tell the page, or
      // the page would still think it is open and refuse to reopen it.
      onClose={onClose}
      onCancel={onClose}
      className="w-[min(32rem,92vw)] rounded-card border border-line bg-surface p-0 text-ink shadow-card backdrop:bg-ink/40"
      aria-labelledby="publish-modal-heading"
      data-testid="publish-modal"
    >
      <form
        method="dialog"
        className="flex flex-col gap-4 p-5"
        onSubmit={(event) => {
          event.preventDefault();
          setTouched(true);
          if (selected.length === 0) return;
          onConfirm(selected);
        }}
      >
        <h2 id="publish-modal-heading" className="font-display text-lg font-bold">
          {strings.publishTitle}
        </h2>
        <p className="text-sm text-ink-muted">{strings.publishIntro}</p>

        {alreadyPublished && (
          <p className="rounded-card bg-brand-soft px-3 py-2 text-sm" data-testid="publish-republish-notice">
            {strings.publishedNotice}
          </p>
        )}
        {unsavedChanges && (
          <p className="rounded-card bg-warn/20 px-3 py-2 text-sm" data-testid="publish-unsaved-warning">
            {strings.publishUnsavedWarning}
          </p>
        )}

        {loading ? (
          <p className="text-sm text-ink-muted">{strings.reviewLoading}</p>
        ) : students.length === 0 ? (
          <p className="text-sm text-ink-muted" data-testid="publish-no-students">
            {strings.publishNoStudents}
          </p>
        ) : (
          <>
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm text-ink-muted" data-testid="publish-selected-count">
                {strings.publishSelectedCount} {selected.length} {strings.publishStudentsOf}{" "}
                {students.length}
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="rounded-card border border-line px-2 py-1 text-sm"
                  onClick={() => {
                    setTouched(true);
                    setSelected(allKeys);
                  }}
                  data-testid="publish-select-all"
                >
                  {strings.publishSelectAll}
                </button>
                <button
                  type="button"
                  className="rounded-card border border-line px-2 py-1 text-sm"
                  onClick={() => {
                    setTouched(true);
                    setSelected([]);
                  }}
                  data-testid="publish-clear-all"
                >
                  {strings.publishClearAll}
                </button>
              </div>
            </div>

            <ul className="max-h-64 overflow-y-auto rounded-card border border-line">
              {students.map((student) => (
                <li key={student.userId} className="border-b border-line last:border-b-0">
                  <label className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm">
                    <input
                      type="checkbox"
                      className="size-4"
                      checked={selected.includes(student.userId)}
                      onChange={() => toggle(student.userId)}
                      data-testid={`publish-student-${student.userId}`}
                    />
                    <span>{student.name}</span>
                  </label>
                </li>
              ))}
            </ul>
          </>
        )}

        {invalid && (
          <p role="alert" className="text-sm font-medium text-danger" data-testid="publish-needs-selection">
            {strings.publishNeedsSelection}
          </p>
        )}
        {failure && (
          <p role="alert" className="rounded-card bg-danger/15 px-3 py-2 text-sm" data-testid="publish-failure">
            <span className="font-semibold">{strings.publishFailedTitle}</span> {failure}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            className="rounded-card border border-line px-4 py-2 font-semibold"
            onClick={onClose}
            disabled={publishing}
            data-testid="publish-cancel"
          >
            {strings.publishCancel}
          </button>
          <button
            type="submit"
            className="rounded-card bg-brand px-4 py-2 font-semibold text-brand-contrast disabled:opacity-60"
            disabled={publishing || students.length === 0}
            data-testid="publish-confirm"
          >
            {publishing ? strings.publishing : strings.publishConfirm}
          </button>
        </div>
      </form>
    </dialog>
  );
}
