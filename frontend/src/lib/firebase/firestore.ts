/**
 * Typed Firestore access helpers for the client (reads + student writes).
 * Teacher content mutations that must be validated go through the backend.
 *
 * NFR3: student inputs / progress / chat mirrors sync within 500ms — prefer
 * onSnapshot listeners over polling everywhere.
 */
import type { Assignment, StudentProgress } from "@/types/models";

export function listenToAssignments(
  studentKey: string,
  onChange: (assignments: Assignment[]) => void
): () => void {
  // TODO Phase 4: query assignments where assignedTo array-contains studentKey
  // and status == "active"; return the unsubscribe function.
  throw new Error("Implement in Phase 4, Step 4.4");
}

export function upsertProgress(progress: Partial<StudentProgress>): Promise<void> {
  // TODO Phase 4: shallow state-machine update of currentExerciseOrder (Fig 4).
  throw new Error("Implement in Phase 4, Step 4.4");
}
