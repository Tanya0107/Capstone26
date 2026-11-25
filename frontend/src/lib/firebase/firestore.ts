/**
 * Typed Firestore access helpers for the client (reads + student writes).
 * Teacher content mutations that must be validated go through the backend.
 *
 * NFR3: student inputs / progress / chat mirrors sync within 500ms, so every
 * read here is an onSnapshot listener and nothing polls.
 *
 * Every query is shaped so the security rules can prove it from its filters
 * alone (D11). A student lists assignments by array-contains on their own
 * uid, modules by array-contains on the denormalized audience, and progress
 * by an equality filter on their own studentKey. Dropping any one of those
 * filters turns the read into a permission-denied error rather than a
 * smaller result, which is the point of the design.
 *
 * Two of these queries need the composite indexes declared in
 * firebase/firestore.indexes.json. The emulator builds indexes on demand and
 * will happily serve a query that fails in production, so the declaration is
 * what makes them real.
 */
import {
  collection,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  where,
  type Timestamp,
} from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import type {
  Assignment,
  StoredCurriculumModule,
  StoredExercise,
  StudentProgress,
} from "@/types/models";

/**
 * Codes the SDK recovers from by itself. A listener does not usually report
 * a lost connection at all, it serves from cache and reconnects, but when
 * one of these does arrive it must not be treated as a dead screen: the
 * student is mid answer and the data on screen is still the truth.
 */
export function isRecoverable(error: Error): boolean {
  const code = (error as { code?: string }).code;
  return code === "unavailable" || code === "cancelled" || code === "deadline-exceeded";
}

/** How many assignments the student dashboard lists. */
export const ASSIGNMENT_PAGE_SIZE = 60;

type Fail = (error: Error) => void;

/**
 * serverTimestamp is null on the local echo of a write, before the server
 * value lands, so a just-published assignment has no date for a moment.
 */
function toIso(value: unknown): string {
  if (!value) return "";
  const stamp = value as Timestamp;
  return typeof stamp.toDate === "function" ? stamp.toDate().toISOString() : "";
}

function toAssignment(id: string, data: Record<string, unknown>): Assignment {
  return {
    assignmentId: id,
    moduleKey: String(data.moduleKey ?? ""),
    teacherKey: String(data.teacherKey ?? ""),
    assignedTo: Array.isArray(data.assignedTo) ? (data.assignedTo as string[]) : [],
    status: data.status === "used" ? "used" : "active",
    publishedAt: toIso(data.publishedAt),
  };
}

function toProgress(id: string, data: Record<string, unknown>): StudentProgress {
  return {
    progressId: id,
    assignmentKey: String(data.assignmentKey ?? ""),
    studentKey: String(data.studentKey ?? ""),
    currentExerciseOrder: Number(data.currentExerciseOrder ?? 0),
    isCompleted: Boolean(data.isCompleted),
    startedAt: toIso(data.startedAt),
    completedAt: toIso(data.completedAt) || undefined,
  };
}

/**
 * The assignments addressed to this student, newest first (FR9).
 *
 * Ordered in Firestore, which needs the
 * assignments(assignedTo contains, status, publishedAt desc) index. An
 * assignment whose publishedAt has not yet reached the server is excluded by
 * that orderBy rather than listed undated, which is correct here: the only
 * writer is a teacher's publish batch in another browser, so by the time
 * this listener sees the document the server value is already on it.
 */
export function listenToAssignments(
  studentKey: string,
  onChange: (assignments: Assignment[]) => void,
  onError: Fail,
): () => void {
  return onSnapshot(
    query(
      collection(db, "assignments"),
      where("assignedTo", "array-contains", studentKey),
      where("status", "==", "active"),
      orderBy("publishedAt", "desc"),
      limit(ASSIGNMENT_PAGE_SIZE),
    ),
    (snapshot) => {
      onChange(snapshot.docs.map((d) => toAssignment(d.id, d.data())));
    },
    (error) => onError(error),
  );
}

/** What the dashboard needs about a module, without its lesson prose. */
export interface AssignedModule {
  moduleKey: string;
  title: string;
  summary: string;
  subject: string;
  gradeLevel: string;
  difficultyLevel: number;
  lessonCount: number;
  exerciseCount: number;
}

function summarizeModule(id: string, data: StoredCurriculumModule): AssignedModule {
  const lessons = Array.isArray(data.lessons) ? data.lessons : [];
  return {
    moduleKey: id,
    title: data.title ?? "",
    summary: data.summary ?? "",
    subject: data.subject ?? "",
    gradeLevel: data.gradeLevel ?? "",
    difficultyLevel: Number(data.difficultyLevel ?? 0),
    lessonCount: lessons.length,
    exerciseCount: lessons.reduce(
      (total, lesson) => total + (lesson.exerciseKeys?.length ?? 0),
      0,
    ),
  };
}

/**
 * Every module published to this student, as one listener rather than a
 * getDoc per assignment. The dashboard joins these to the assignments by
 * moduleKey, so a publish that lands while the page is open brings its
 * module with it and the card can render complete on first paint.
 */
export function listenToAssignedModules(
  studentKey: string,
  onChange: (modules: AssignedModule[]) => void,
  onError: Fail,
): () => void {
  return onSnapshot(
    query(
      collection(db, "curriculumModules"),
      where("assignedStudentKeys", "array-contains", studentKey),
      limit(ASSIGNMENT_PAGE_SIZE),
    ),
    (snapshot) => {
      onChange(
        snapshot.docs.map((d) => summarizeModule(d.id, d.data() as StoredCurriculumModule)),
      );
    },
    (error) => onError(error),
  );
}

/** This student's progress across all their assignments (FR13 history). */
export function listenToMyProgress(
  studentKey: string,
  onChange: (progress: StudentProgress[]) => void,
  onError: Fail,
): () => void {
  return onSnapshot(
    query(collection(db, "studentProgress"), where("studentKey", "==", studentKey)),
    (snapshot) => {
      onChange(snapshot.docs.map((d) => toProgress(d.id, d.data())));
    },
    (error) => onError(error),
  );
}

/** One assignment, live, for the workspace. null means it does not exist. */
export function listenToAssignment(
  assignmentKey: string,
  onChange: (assignment: Assignment | null) => void,
  onError: Fail,
): () => void {
  return onSnapshot(
    doc(db, "assignments", assignmentKey),
    (snapshot) => {
      onChange(snapshot.exists() ? toAssignment(snapshot.id, snapshot.data()) : null);
    },
    (error) => onError(error),
  );
}

/**
 * One module, live. A student reaches this only for a module whose audience
 * contains their uid, which the rules check on the document itself.
 */
export function listenToModule(
  moduleKey: string,
  onChange: (module: StoredCurriculumModule | null) => void,
  onError: Fail,
): () => void {
  return onSnapshot(
    doc(db, "curriculumModules", moduleKey),
    (snapshot) => {
      onChange(snapshot.exists() ? (snapshot.data() as StoredCurriculumModule) : null);
    },
    (error) => onError(error),
  );
}

/**
 * The exercises of one module in order (FR10).
 *
 * The audience filter is not redundant with the moduleKey filter. It is the
 * clause that makes the list provable under the rules, and it needs the
 * exercises(assignedStudentKeys contains, moduleKey, order) index.
 *
 * These documents carry no answer field by construction (R6, D11), so there
 * is nothing here for the student client to leak.
 */
export function listenToModuleExercises(
  moduleKey: string,
  studentKey: string,
  onChange: (exercises: StoredExercise[]) => void,
  onError: Fail,
): () => void {
  return onSnapshot(
    query(
      collection(db, "exercises"),
      where("assignedStudentKeys", "array-contains", studentKey),
      where("moduleKey", "==", moduleKey),
      orderBy("order", "asc"),
    ),
    (snapshot) => {
      onChange(
        snapshot.docs.map((d) => {
          const data = d.data();
          return {
            exerciseId: d.id,
            moduleKey: String(data.moduleKey ?? ""),
            order: Number(data.order ?? 0),
            prompt: String(data.prompt ?? ""),
            scaffoldSteps: Array.isArray(data.scaffoldSteps)
              ? (data.scaffoldSteps as string[])
              : [],
            assignedStudentKeys: Array.isArray(data.assignedStudentKeys)
              ? (data.assignedStudentKeys as string[])
              : [],
          };
        }),
      );
    },
    (error) => onError(error),
  );
}

/**
 * A student has exactly one progress document per assignment, so its id is
 * derived rather than generated. That is what makes the write below an
 * idempotent upsert instead of a query, a branch and a create, and it is
 * what lets a queued offline write be replayed safely any number of times.
 */
export function progressDocId(assignmentKey: string, studentKey: string): string {
  return `${assignmentKey}__${studentKey}`;
}

/**
 * This student's progress on one assignment, live. null means they have not
 * started it.
 *
 * A query of one document rather than a get of a known id, and the
 * difference is not stylistic. The rule on studentProgress reads
 * resource.data.studentKey, and for a document that does not exist resource
 * is null, so a get on a missing document is refused with a null value
 * error rather than answered with "no such document". Measured against the
 * emulator with a real student token: HTTP 403, "evaluation error ... Null
 * value error" from the rule. A student's first visit to a workspace is
 * exactly that case, so a get listener would hand every new assignment a
 * permission error and the progress document would never be created.
 *
 * A list is evaluated against the query instead of against a missing
 * document, so the same student reading the same data gets an empty result.
 * Two equality filters need no composite index, Firestore serves them by
 * merging single field indexes.
 *
 * Writes still address the document by its derived id, which is where
 * idempotence matters. See docs/DECISIONS.md D21.
 */
export function listenToProgress(
  assignmentKey: string,
  studentKey: string,
  onChange: (progress: StudentProgress | null) => void,
  onError: Fail,
): () => void {
  return onSnapshot(
    query(
      collection(db, "studentProgress"),
      where("studentKey", "==", studentKey),
      where("assignmentKey", "==", assignmentKey),
      limit(1),
    ),
    (snapshot) => {
      const first = snapshot.docs[0];
      onChange(first ? toProgress(first.id, first.data()) : null);
    },
    (error) => onError(error),
  );
}

/**
 * The state machine write of Fig 4. assignmentKey and studentKey are
 * required because they address the document and the rules check the second
 * one against the caller's uid, which is why they are written on every
 * upsert rather than only at creation.
 */
export interface ProgressUpdate {
  assignmentKey: string;
  studentKey: string;
  /** Furthest exercise order the student has reached, not the one on screen. */
  currentExerciseOrder?: number;
  isCompleted?: boolean;
  /** Stamp startedAt with the server clock. Pass it on the first write only. */
  markStarted?: boolean;
}

/**
 * Advance a student's progress (FR10, FR13).
 *
 * A merge write, so a replay of a queued update cannot erase startedAt or an
 * order that moved on in the meantime. completedAt is stamped by this
 * function rather than by the caller, because a client clock is not evidence
 * of when anything happened.
 *
 * Offline this promise does not settle: the Firestore SDK holds the write
 * and resolves only on the server ack. Callers must therefore treat a
 * pending promise as normal and keep their own durable copy of the intent,
 * which is what lib/student/answerBuffer does, since the SDK's queue lives
 * in memory and does not survive a reload.
 */
export function upsertProgress(progress: ProgressUpdate): Promise<void> {
  const { assignmentKey, studentKey, markStarted, ...rest } = progress;
  if (!assignmentKey || !studentKey) {
    return Promise.reject(new Error("upsertProgress needs assignmentKey and studentKey"));
  }
  const payload: Record<string, unknown> = { assignmentKey, studentKey, ...rest };
  if (markStarted) payload.startedAt = serverTimestamp();
  if (rest.isCompleted) payload.completedAt = serverTimestamp();
  return setDoc(doc(db, "studentProgress", progressDocId(assignmentKey, studentKey)), payload, {
    merge: true,
  });
}
