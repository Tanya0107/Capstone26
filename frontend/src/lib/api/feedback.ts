/**
 * Client for POST /api/feedback/edits (FR6 Adaptive Learning).
 *
 * One record per edited field, not one record for the whole module. The
 * backend scores an edit by the cosine distance between the original and
 * the edited text and only stores it above EDIT_SIGNIFICANCE_THRESHOLD.
 * A single record carrying the whole module would bury a real rewrite of
 * one hook under all the text that did not change, score close to zero and
 * be discarded, so the memory bank would learn nothing from a genuine
 * edit. The stored body is a "instead of X, the teacher preferred Y" pair,
 * which is per field by construction.
 */
import { backendUrl } from "@/lib/api/backend";
import type { FeedbackIngestResponse, TeacherEditRecord } from "@/types/models";

/** One edited field, with enough context to report what happened. */
export interface EditDiff {
  /** Where the change was, for the UI only. Never sent. */
  label: string;
  originalText: string;
  editedText: string;
}

export interface EditIngestOutcome extends EditDiff {
  stored: boolean;
  semanticDistance: number | null;
  failed: boolean;
}

/**
 * File every diff. A rejected or failed record must not lose the rest, so
 * each is awaited separately and its outcome reported. Saving the content
 * already succeeded by the time this runs, so a failure here is worth
 * telling the teacher about but is not a failed save.
 */
export async function postTeacherEdits(
  teacherKey: string,
  moduleKey: string,
  idToken: string,
  diffs: EditDiff[],
): Promise<EditIngestOutcome[]> {
  const outcomes: EditIngestOutcome[] = [];
  for (const diff of diffs) {
    const record: TeacherEditRecord = {
      teacherKey,
      moduleKey,
      originalText: diff.originalText,
      editedText: diff.editedText,
    };
    try {
      const response = await fetch(backendUrl("/api/feedback/edits"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify(record),
      });
      if (!response.ok) {
        outcomes.push({ ...diff, stored: false, semanticDistance: null, failed: true });
        continue;
      }
      const body = (await response.json()) as FeedbackIngestResponse;
      outcomes.push({
        ...diff,
        stored: Boolean(body.stored),
        semanticDistance:
          typeof body.semanticDistance === "number" ? body.semanticDistance : null,
        failed: false,
      });
    } catch {
      outcomes.push({ ...diff, stored: false, semanticDistance: null, failed: true });
    }
  }
  return outcomes;
}
