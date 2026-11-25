/**
 * Firestore security rules tests (BUILD_GUIDE Step 2.2).
 * Runs against the Firestore emulator, wired into CI via emulators:exec.
 *
 * Covered cases, minimum set from the guide:
 *   student cannot read exerciseSolutions or feedbackMemoryBank
 *   student can read only assignments containing their uid in assignedTo
 *   student can create telemetryEvents only with studentKey == auth.uid
 *   student can write only own studentProgress, and nobody can delete it
 *   student cannot update or delete any telemetryEvents
 *   teacher can create and update own curriculumModules, not another teacher's
 *   unauthenticated requests are denied everywhere
 * Plus the D11 audience gating on exercises and curriculumModules.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { beforeAll, afterAll, beforeEach, describe, it } from "vitest";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";

const here = dirname(fileURLToPath(import.meta.url));
let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-enrichment",
    firestore: {
      rules: readFileSync(join(here, "firestore.rules"), "utf8"),
      host: "localhost",
      port: 8080,
    },
  });
});

afterAll(async () => {
  await env.cleanup();
});

beforeEach(async () => {
  await env.clearFirestore();
  // Seed role docs and fixtures with rules disabled
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, "users/t1"), { name: "T1", role: "teacher", schoolKey: "school1" });
    await setDoc(doc(db, "users/t2"), { name: "T2", role: "teacher", schoolKey: "school1" });
    await setDoc(doc(db, "users/s1"), { name: "S1", role: "student", schoolKey: "school1" });
    await setDoc(doc(db, "users/s2"), { name: "S2", role: "student", schoolKey: "school1" });
    await setDoc(doc(db, "schools/school1"), { schoolName: "Demo", location: "IL" });
    await setDoc(doc(db, "curriculumModules/m1"), {
      title: "Fractions",
      subject: "math",
      creatorTeacherKey: "t1",
      status: "published",
      assignedStudentKeys: ["s1"],
    });
    await setDoc(doc(db, "curriculumModules/m2"), {
      title: "Cells",
      subject: "science",
      creatorTeacherKey: "t2",
      status: "draft",
      assignedStudentKeys: [],
    });
    await setDoc(doc(db, "exercises/e1"), {
      moduleKey: "m1",
      order: 1,
      prompt: "How much is half of a half?",
      assignedStudentKeys: ["s1"],
    });
    await setDoc(doc(db, "exerciseSolutions/e1"), {
      exerciseKey: "e1",
      moduleKey: "m1",
      correctAnswer: "1/4",
      socraticHints: [],
    });
    await setDoc(doc(db, "assignments/a1"), {
      moduleKey: "m1",
      teacherKey: "t1",
      assignedTo: ["s1"],
      status: "active",
    });
    await setDoc(doc(db, "assignments/a2"), {
      moduleKey: "m1",
      teacherKey: "t1",
      assignedTo: ["s2"],
      status: "active",
    });
    await setDoc(doc(db, "studentProgress/a1__s1"), {
      assignmentKey: "a1",
      studentKey: "s1",
      currentExerciseOrder: 0,
      isCompleted: false,
    });
    await setDoc(doc(db, "studentProgress/a2__s2"), {
      assignmentKey: "a2",
      studentKey: "s2",
      currentExerciseOrder: 1,
      isCompleted: false,
    });
    await setDoc(doc(db, "telemetryEvents/ev1"), {
      studentKey: "s1",
      exerciseKey: "e1",
      assignmentKey: "a1",
      attSeconds: 30,
      hsrcCount: 0,
    });
    await setDoc(doc(db, "feedbackMemoryBank/mem1"), {
      teacherKey: "t1",
      moduleKey: "m1",
      teacherModifications: "prefer word problems",
      semanticDistance: 0.4,
    });
  });
});

const asStudent = () => env.authenticatedContext("s1").firestore();
const asTeacher = () => env.authenticatedContext("t1").firestore();
const asAnon = () => env.unauthenticatedContext().firestore();

describe("answer protection (R6, D11)", () => {
  it("student cannot read exerciseSolutions", async () => {
    await assertFails(getDoc(doc(asStudent(), "exerciseSolutions/e1")));
  });

  it("teacher can read exerciseSolutions", async () => {
    await assertSucceeds(getDoc(doc(asTeacher(), "exerciseSolutions/e1")));
  });

  it("student cannot read feedbackMemoryBank", async () => {
    await assertFails(getDoc(doc(asStudent(), "feedbackMemoryBank/mem1")));
  });

  it("teacher cannot read feedbackMemoryBank, backend only", async () => {
    await assertFails(getDoc(doc(asTeacher(), "feedbackMemoryBank/mem1")));
  });
});

describe("content audience gating (D11)", () => {
  it("assigned student reads the exercise, safe fields only by design", async () => {
    await assertSucceeds(getDoc(doc(asStudent(), "exercises/e1")));
  });

  it("non assigned student cannot read the exercise", async () => {
    const s2 = env.authenticatedContext("s2").firestore();
    await assertFails(getDoc(doc(s2, "exercises/e1")));
  });

  it("assigned student reads the published module", async () => {
    await assertSucceeds(getDoc(doc(asStudent(), "curriculumModules/m1")));
  });

  it("student cannot read an unpublished module with empty audience", async () => {
    await assertFails(getDoc(doc(asStudent(), "curriculumModules/m2")));
  });

  it("student can query exercises with the required audience filter", async () => {
    const q = query(
      collection(asStudent(), "exercises"),
      where("assignedStudentKeys", "array-contains", "s1"),
      where("moduleKey", "==", "m1")
    );
    await assertSucceeds(getDocs(q));
  });
});

describe("assignments", () => {
  it("student reads an assignment addressed to them", async () => {
    await assertSucceeds(getDoc(doc(asStudent(), "assignments/a1")));
  });

  it("student cannot read an assignment addressed to someone else", async () => {
    await assertFails(getDoc(doc(asStudent(), "assignments/a2")));
  });

  it("student can query only with the array-contains own uid filter", async () => {
    const ok = query(
      collection(asStudent(), "assignments"),
      where("assignedTo", "array-contains", "s1")
    );
    await assertSucceeds(getDocs(ok));
    const all = collection(asStudent(), "assignments");
    await assertFails(getDocs(all));
  });
});

describe("telemetryEvents append only log", () => {
  it("student creates an event with own studentKey", async () => {
    await assertSucceeds(
      setDoc(doc(asStudent(), "telemetryEvents/new1"), {
        studentKey: "s1",
        exerciseKey: "e1",
        assignmentKey: "a1",
        attSeconds: 10,
        hsrcCount: 1,
      })
    );
  });

  it("student cannot create an event with another studentKey", async () => {
    await assertFails(
      setDoc(doc(asStudent(), "telemetryEvents/new2"), {
        studentKey: "s2",
        exerciseKey: "e1",
        assignmentKey: "a1",
        attSeconds: 10,
        hsrcCount: 0,
      })
    );
  });

  it("student cannot update or delete any event", async () => {
    await assertFails(updateDoc(doc(asStudent(), "telemetryEvents/ev1"), { attSeconds: 999 }));
    await assertFails(deleteDoc(doc(asStudent(), "telemetryEvents/ev1")));
  });

  it("teacher cannot update or delete events either", async () => {
    await assertFails(updateDoc(doc(asTeacher(), "telemetryEvents/ev1"), { attSeconds: 999 }));
    await assertFails(deleteDoc(doc(asTeacher(), "telemetryEvents/ev1")));
  });
});

describe("curriculumModules ownership", () => {
  it("teacher creates a module owned by themselves", async () => {
    await assertSucceeds(
      setDoc(doc(asTeacher(), "curriculumModules/new1"), {
        title: "Decimals",
        subject: "math",
        creatorTeacherKey: "t1",
        status: "draft",
        assignedStudentKeys: [],
      })
    );
  });

  it("teacher cannot create a module owned by another teacher", async () => {
    await assertFails(
      setDoc(doc(asTeacher(), "curriculumModules/new2"), {
        title: "Decimals",
        subject: "math",
        creatorTeacherKey: "t2",
        status: "draft",
        assignedStudentKeys: [],
      })
    );
  });

  it("teacher updates own module", async () => {
    await assertSucceeds(updateDoc(doc(asTeacher(), "curriculumModules/m1"), { title: "Fractions 2" }));
  });

  it("teacher cannot update another teacher's module", async () => {
    await assertFails(updateDoc(doc(asTeacher(), "curriculumModules/m2"), { title: "Hijack" }));
  });

  it("teacher cannot take ownership of another teacher's module", async () => {
    await assertFails(
      updateDoc(doc(asTeacher(), "curriculumModules/m2"), { creatorTeacherKey: "t1" })
    );
  });
});

describe("studentProgress ownership (Step 4.4)", () => {
  // The first student write the product makes. The doc id is
  // assignmentKey__studentKey so a student has exactly one progress doc per
  // assignment, which is what makes the write an idempotent upsert rather
  // than a query followed by a create.
  it("student creates own progress with the deterministic id", async () => {
    await assertSucceeds(
      setDoc(doc(asStudent(), "studentProgress/a1__s1_new"), {
        assignmentKey: "a1",
        studentKey: "s1",
        currentExerciseOrder: 0,
        isCompleted: false,
      })
    );
  });

  it("student cannot create progress for another student", async () => {
    await assertFails(
      setDoc(doc(asStudent(), "studentProgress/a2__s2_new"), {
        assignmentKey: "a2",
        studentKey: "s2",
        currentExerciseOrder: 0,
        isCompleted: false,
      })
    );
  });

  it("student advances own progress", async () => {
    await assertSucceeds(
      updateDoc(doc(asStudent(), "studentProgress/a1__s1"), { currentExerciseOrder: 2 })
    );
  });

  it("student cannot advance another student's progress", async () => {
    await assertFails(
      updateDoc(doc(asStudent(), "studentProgress/a2__s2"), { currentExerciseOrder: 2 })
    );
  });

  it("student cannot rewrite a progress doc onto another studentKey", async () => {
    await assertFails(
      updateDoc(doc(asStudent(), "studentProgress/a1__s1"), { studentKey: "s2" })
    );
  });

  it("student reads own progress and not another student's", async () => {
    await assertSucceeds(getDoc(doc(asStudent(), "studentProgress/a1__s1")));
    await assertFails(getDoc(doc(asStudent(), "studentProgress/a2__s2")));
  });

  it("student can query only with the own studentKey filter", async () => {
    const ok = query(
      collection(asStudent(), "studentProgress"),
      where("studentKey", "==", "s1")
    );
    await assertSucceeds(getDocs(ok));
    await assertFails(getDocs(collection(asStudent(), "studentProgress")));
  });

  // The reason lib/firebase/firestore.listenToProgress uses a query and not a
  // get. The rule reads resource.data.studentKey, and resource is null for a
  // document that does not exist, so the get is refused with a null value
  // error instead of answered with "no such document". A student's first
  // visit to a workspace is that case.
  it("a get of a missing progress document is refused, a query is not", async () => {
    await assertFails(getDoc(doc(asStudent(), "studentProgress/no_such_assignment__s1")));
    await assertSucceeds(
      getDocs(
        query(
          collection(asStudent(), "studentProgress"),
          where("studentKey", "==", "s1"),
          where("assignmentKey", "==", "no_such_assignment"),
        )
      )
    );
  });

  it("teacher reads student progress, which FR8 analytics needs", async () => {
    await assertSucceeds(getDoc(doc(asTeacher(), "studentProgress/a1__s1")));
    await assertSucceeds(getDocs(collection(asTeacher(), "studentProgress")));
  });

  it("nobody deletes progress", async () => {
    await assertFails(deleteDoc(doc(asStudent(), "studentProgress/a1__s1")));
    await assertFails(deleteDoc(doc(asTeacher(), "studentProgress/a1__s1")));
  });
});

describe("unauthenticated access", () => {
  it("denied on every collection", async () => {
    await assertFails(getDoc(doc(asAnon(), "users/t1")));
    await assertFails(getDoc(doc(asAnon(), "schools/school1")));
    await assertFails(getDoc(doc(asAnon(), "curriculumModules/m1")));
    await assertFails(getDoc(doc(asAnon(), "exercises/e1")));
    await assertFails(getDoc(doc(asAnon(), "exerciseSolutions/e1")));
    await assertFails(getDoc(doc(asAnon(), "assignments/a1")));
    await assertFails(getDoc(doc(asAnon(), "studentProgress/a1__s1")));
    await assertFails(getDoc(doc(asAnon(), "telemetryEvents/ev1")));
    await assertFails(
      setDoc(doc(asAnon(), "telemetryEvents/anon1"), { studentKey: "s1", attSeconds: 1 })
    );
  });
});
