/**
 * The teacher's own modules, for the teacher dashboard (FR5, Q13).
 *
 * A live listener rather than a one shot read, for the reason the screen
 * exists. Generation is a single blocking request, so when the browser
 * gives up on a run that the server then finishes, the module is
 * persisted with nobody holding its key. A listener means that module
 * appears here by itself, which is the only way a teacher can ever reach
 * it.
 *
 * The query is ordered in Firestore, not in JavaScript, so it needs the
 * composite index on (creatorTeacherKey, createdAt desc) declared in
 * firebase/firestore.indexes.json. The emulator creates indexes on demand
 * and would happily serve a query that fails in production, which is why
 * the declaration matters more than the local result.
 */
import {
  collection,
  limit,
  onSnapshot,
  orderBy,
  query,
  where,
  type Timestamp,
} from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import type { StoredCurriculumModule } from "@/types/models";

/** How many modules the dashboard lists. Pagination is not in scope here. */
export const MODULE_PAGE_SIZE = 60;

export interface ModuleSummary {
  moduleKey: string;
  title: string;
  subject: string;
  gradeLevel: string;
  difficultyLevel: number;
  status: "draft" | "published";
  createdAt: Date | null;
  lessonCount: number;
  exerciseCount: number;
  criticApproved: boolean | null;
  assignedCount: number;
}

function toDate(value: unknown): Date | null {
  // serverTimestamp is null on the local echo of a write, before the
  // server value arrives, so a freshly created module has no date yet.
  if (!value) return null;
  const stamp = value as Timestamp;
  return typeof stamp.toDate === "function" ? stamp.toDate() : null;
}

function summarize(moduleKey: string, data: StoredCurriculumModule): ModuleSummary {
  const lessons = Array.isArray(data.lessons) ? data.lessons : [];
  return {
    moduleKey,
    title: data.title ?? "",
    subject: data.subject ?? "",
    gradeLevel: data.gradeLevel ?? "",
    difficultyLevel: Number(data.difficultyLevel ?? 0),
    status: data.status === "published" ? "published" : "draft",
    createdAt: toDate(data.createdAt),
    lessonCount: lessons.length,
    exerciseCount: lessons.reduce(
      (total, lesson) => total + (lesson.exerciseKeys?.length ?? 0),
      0,
    ),
    criticApproved:
      typeof data.criticReport?.approved === "boolean" ? data.criticReport.approved : null,
    assignedCount: (data.assignedStudentKeys ?? []).length,
  };
}

/**
 * Listen to the modules this teacher created, newest first. Returns the
 * unsubscribe function.
 */
export function listenToMyModules(
  teacherKey: string,
  onChange: (modules: ModuleSummary[]) => void,
  onError: (error: Error) => void,
): () => void {
  return onSnapshot(
    query(
      collection(db, "curriculumModules"),
      where("creatorTeacherKey", "==", teacherKey),
      orderBy("createdAt", "desc"),
      limit(MODULE_PAGE_SIZE),
    ),
    (snapshot) => {
      onChange(
        snapshot.docs.map((doc) => summarize(doc.id, doc.data() as StoredCurriculumModule)),
      );
    },
    (error) => onError(error),
  );
}
