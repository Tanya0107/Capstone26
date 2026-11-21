/**
 * Review Dashboard data layer (Step 4.3, FR5 and FR7).
 *
 * A teacher reads a module back out of the three collections it was split
 * across, edits it, and publishes it. The split is D11: student safe fields
 * in exercises, answers and hints in exerciseSolutions. Reassembly has to
 * happen on the client because there is no read endpoint for a module, and
 * rules already let a teacher read both collections.
 *
 * Every write here is batched. A publish that set the audience on the
 * module but not on the exercises would leave students able to list a
 * module whose exercises they cannot read, which looks like a broken
 * assignment rather than a failed write.
 */
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  where,
  writeBatch,
} from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import type {
  LessonMeta,
  SocraticHint,
  StoredCurriculumModule,
  User,
} from "@/types/models";

/** One exercise as the teacher reviews it, both halves joined back together. */
export interface ReviewExercise {
  exerciseKey: string;
  order: number;
  prompt: string;
  scaffoldSteps: string[];
  correctAnswer: string;
  socraticHints: SocraticHint[];
  /** True when no exerciseSolutions doc was readable for this exercise. */
  solutionMissing?: boolean;
}

export interface ReviewLesson {
  title: string;
  objectives: string[];
  hook: string;
  exercises: ReviewExercise[];
}

export interface ReviewModule {
  moduleKey: string;
  module: StoredCurriculumModule;
  lessons: ReviewLesson[];
}

export class ReviewLoadError extends Error {
  constructor(
    message: string,
    readonly kind: "not_found" | "forbidden" | "unknown",
  ) {
    super(message);
    this.name = "ReviewLoadError";
  }
}

function hintsOf(raw: unknown): SocraticHint[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((h, index) => ({
      hintOrder: Number((h as SocraticHint)?.hintOrder ?? index + 1),
      hintText: String((h as SocraticHint)?.hintText ?? ""),
    }))
    .sort((a, b) => a.hintOrder - b.hintOrder);
}

/**
 * Load one module for review. Exercises are fetched by key from the lesson
 * metadata rather than by a moduleKey query, because the metadata is what
 * fixes their order inside a lesson, and a query would lose that.
 */
export async function fetchModuleForReview(moduleKey: string): Promise<ReviewModule> {
  let snapshot;
  try {
    snapshot = await getDoc(doc(db, "curriculumModules", moduleKey));
  } catch (err) {
    throw new ReviewLoadError(String(err), "forbidden");
  }
  if (!snapshot.exists()) {
    throw new ReviewLoadError(`No module ${moduleKey}`, "not_found");
  }
  const moduleDoc = snapshot.data() as StoredCurriculumModule;
  const lessonsMeta: LessonMeta[] = Array.isArray(moduleDoc.lessons) ? moduleDoc.lessons : [];

  const lessons: ReviewLesson[] = await Promise.all(
    lessonsMeta.map(async (meta) => {
      const keys = Array.isArray(meta.exerciseKeys) ? meta.exerciseKeys : [];
      const exercises = await Promise.all(
        keys.map(async (key): Promise<ReviewExercise | null> => {
          const [exerciseSnap, solutionSnap] = await Promise.all([
            getDoc(doc(db, "exercises", key)),
            getDoc(doc(db, "exerciseSolutions", key)),
          ]);
          if (!exerciseSnap.exists()) return null;
          const ex = exerciseSnap.data() as Record<string, unknown>;
          const sol = solutionSnap.exists()
            ? (solutionSnap.data() as Record<string, unknown>)
            : null;
          return {
            exerciseKey: key,
            order: Number(ex.order ?? 0),
            prompt: String(ex.prompt ?? ""),
            scaffoldSteps: Array.isArray(ex.scaffoldSteps)
              ? (ex.scaffoldSteps as string[])
              : [],
            correctAnswer: sol ? String(sol.correctAnswer ?? "") : "",
            socraticHints: sol ? hintsOf(sol.socraticHints) : [],
            solutionMissing: sol === null,
          };
        }),
      );
      return {
        title: meta.title ?? "",
        objectives: Array.isArray(meta.objectives) ? meta.objectives : [],
        hook: meta.hook ?? "",
        exercises: exercises.filter((e): e is ReviewExercise => e !== null),
      };
    }),
  );

  return { moduleKey, module: moduleDoc, lessons };
}

/** Students of one school, the FR7 distribution list. */
export async function listSchoolStudents(schoolKey: string): Promise<User[]> {
  const rows = await getDocs(
    query(
      collection(db, "users"),
      where("role", "==", "student"),
      where("schoolKey", "==", schoolKey),
    ),
  );
  return rows.docs
    .map((d) => ({ userId: d.id, ...(d.data() as Omit<User, "userId">) }))
    .sort((a, b) => a.name.localeCompare(b.name, "he"));
}

/**
 * Persist an edited module. Writes the lesson prose back onto the module
 * doc and each exercise back into its own two docs, keeping the R6 split:
 * prompt and scaffold steps to exercises, answer and hints to
 * exerciseSolutions, never the other way round.
 *
 * Orders are left exactly as they were. Critic issues reference an
 * exercise by its order, so renumbering after a delete would silently
 * repoint every issue at the wrong exercise.
 */
export async function saveModuleEdits(
  moduleKey: string,
  lessons: ReviewLesson[],
  removedExerciseKeys: string[],
): Promise<void> {
  const batch = writeBatch(db);
  const lessonsMeta: LessonMeta[] = [];

  for (const lesson of lessons) {
    const exerciseKeys: string[] = [];
    for (const exercise of lesson.exercises) {
      const isNew = exercise.exerciseKey.startsWith("new:");
      const ref = isNew
        ? doc(collection(db, "exercises"))
        : doc(db, "exercises", exercise.exerciseKey);
      batch.set(
        ref,
        {
          moduleKey,
          order: exercise.order,
          prompt: exercise.prompt,
          scaffoldSteps: exercise.scaffoldSteps,
        },
        { merge: true },
      );
      batch.set(
        doc(db, "exerciseSolutions", ref.id),
        {
          exerciseKey: ref.id,
          moduleKey,
          correctAnswer: exercise.correctAnswer,
          socraticHints: exercise.socraticHints,
        },
        { merge: true },
      );
      exerciseKeys.push(ref.id);
    }
    lessonsMeta.push({
      title: lesson.title,
      objectives: lesson.objectives,
      hook: lesson.hook,
      exerciseKeys,
    });
  }

  batch.set(doc(db, "curriculumModules", moduleKey), { lessons: lessonsMeta }, { merge: true });
  await batch.commit();

  // Deletions run after the module no longer references them, so a failure
  // here leaves orphan docs rather than a lesson pointing at nothing.
  await Promise.all(
    removedExerciseKeys
      .filter((key) => !key.startsWith("new:"))
      .flatMap((key) => [
        deleteDoc(doc(db, "exercises", key)).catch(() => undefined),
        deleteDoc(doc(db, "exerciseSolutions", key)).catch(() => undefined),
      ]),
  );
}

/**
 * Publish to a distribution list (FR7). One batch creates the assignment
 * and denormalizes the audience onto the module and every exercise, which
 * is what the security rules read (D11).
 */
export async function publishModule(
  moduleKey: string,
  teacherKey: string,
  studentKeys: string[],
  exerciseKeys: string[],
): Promise<string> {
  if (studentKeys.length === 0) {
    throw new Error("A publish needs at least one student");
  }
  const batch = writeBatch(db);
  const assignmentRef = doc(collection(db, "assignments"));
  batch.set(assignmentRef, {
    moduleKey,
    teacherKey,
    assignedTo: studentKeys,
    status: "active",
    publishedAt: serverTimestamp(),
  });
  batch.set(
    doc(db, "curriculumModules", moduleKey),
    { status: "published", assignedStudentKeys: studentKeys },
    { merge: true },
  );
  for (const key of exerciseKeys) {
    batch.set(doc(db, "exercises", key), { assignedStudentKeys: studentKeys }, { merge: true });
  }
  await batch.commit();
  return assignmentRef.id;
}
