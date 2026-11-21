/**
 * Step 4.3 acceptance: edit, save, memory bank record, publish, assignment.
 *
 * Drives the real Review Dashboard against the real emulators and the real
 * feedback endpoint, then verifies the results by reading Firestore
 * directly rather than by trusting the UI's own success message.
 *
 * Verification uses the emulator REST API with the owner bearer token,
 * which bypasses security rules. Reading back as the teacher would only
 * prove what a teacher can see, and the point of these checks is what was
 * actually written, including the docs a teacher is not meant to change.
 *
 * Text is entered through the native value setter, never by typing (D19).
 * CDP key events are not delivered to an authenticated page in this rig,
 * so a harness that types here measures the rig and not the product.
 *
 * Prerequisites: emulators, seeded users, uvicorn on 8000, and a built
 * frontend served by next start. Install tooling with
 *   npm i --no-save puppeteer-core
 * Run from frontend/:
 *   node scripts/dev_review_dashboard_demo.mjs [moduleKey]
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import puppeteer from "puppeteer-core";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";
const CHROME_PATH =
  process.env.CHROME_PATH ??
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PASSWORD = process.env.DEMO_PASSWORD ?? "Demo1234";
const PROJECT = process.env.FIREBASE_PROJECT ?? "demo-enrichment";
const FIRESTORE = `http://localhost:8080/v1/projects/${PROJECT}/databases/(default)/documents`;
const OUT_PATH = resolve("../evaluation/results/dev_runs/review_dashboard_demo.json");

// Must be a real rewrite, not a tweak. The backend only stores an edit
// whose cosine distance exceeds EDIT_SIGNIFICANCE_THRESHOLD of 0.15, so a
// one word change would legitimately not be stored and the acceptance
// check for a memory bank record would fail for the right reason.
const NEW_HOOK =
  "נתחיל מסיפור על חלוקת פיצה במשפחה גדולה, ומשם נבנה יחד את הצורך במכנה משותף";

async function emu(path) {
  const response = await fetch(`${FIRESTORE}${path}`, {
    headers: { Authorization: "Bearer owner" },
  });
  if (!response.ok) {
    throw new Error(`emulator read ${path} failed: ${response.status}`);
  }
  return response.json();
}

/** Firestore REST values are tagged unions, so unwrap to plain JS. */
function plain(value) {
  if (value === undefined || value === null) return null;
  if ("stringValue" in value) return value.stringValue;
  if ("integerValue" in value) return Number(value.integerValue);
  if ("doubleValue" in value) return value.doubleValue;
  if ("booleanValue" in value) return value.booleanValue;
  if ("timestampValue" in value) return value.timestampValue;
  if ("nullValue" in value) return null;
  if ("arrayValue" in value) return (value.arrayValue.values ?? []).map(plain);
  if ("mapValue" in value) {
    return Object.fromEntries(
      Object.entries(value.mapValue.fields ?? {}).map(([k, v]) => [k, plain(v)]),
    );
  }
  return null;
}

async function moduleDoc(moduleKey) {
  return plain({ mapValue: { fields: (await emu(`/curriculumModules/${moduleKey}`)).fields } });
}

async function listCollection(name) {
  const out = [];
  let pageToken = "";
  do {
    const query = `?pageSize=300${pageToken ? `&pageToken=${pageToken}` : ""}`;
    const body = await emu(`/${name}${query}`);
    for (const doc of body.documents ?? []) {
      out.push({
        id: doc.name.split("/").pop(),
        data: plain({ mapValue: { fields: doc.fields } }),
      });
    }
    pageToken = body.nextPageToken ?? "";
  } while (pageToken);
  return out;
}

/** Set a field the way a person would, without dispatching key events. */
async function setField(page, testid, value) {
  await page.$eval(
    `[data-testid="${testid}"]`,
    (el, text) => {
      const proto =
        el instanceof HTMLTextAreaElement
          ? HTMLTextAreaElement.prototype
          : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, "value").set.call(el, text);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    },
    value,
  );
}

async function signIn(page) {
  await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector('[data-testid="login-submit"]', { timeout: 60000 });
  await page.type('[data-testid="login-email"]', "teacher1@demo.school");
  await page.type('[data-testid="login-password"]', PASSWORD);
  await page.click('[data-testid="login-submit"]');
  await page.waitForFunction(() => window.location.pathname === "/teacher/dashboard", {
    timeout: 60000,
  });
}

/** Newest draft module belonging to the demo teacher, when none was named. */
async function pickModule() {
  const modules = await listCollection("curriculumModules");
  const mine = modules
    .filter((m) => m.data.creatorTeacherKey === "t1" && Array.isArray(m.data.lessons))
    .filter((m) => m.data.lessons.length > 0)
    .sort((a, b) => String(b.data.createdAt).localeCompare(String(a.data.createdAt)));
  if (mine.length === 0) throw new Error("no module with lessons found for teacher t1");
  return mine[0].id;
}

const record = { label: "DEV demo evidence, not an evaluation result (R1)", checks: {} };
const browser = await puppeteer.launch({
  executablePath: CHROME_PATH,
  headless: true,
  args: ["--no-first-run", "--no-default-browser-check"],
});
const page = await browser.newPage();
const failures = [];
const check = (name, ok, detail) => {
  record.checks[name] = { ok, ...(detail === undefined ? {} : { detail }) };
  if (!ok) failures.push(name);
};

try {
  const moduleKey = process.argv[2] ?? (await pickModule());
  record.moduleKey = moduleKey;
  record.timestamp = new Date().toISOString();

  const before = await moduleDoc(moduleKey);
  const memoriesBefore = await listCollection("feedbackMemoryBank");

  await signIn(page);
  await page.goto(`${BASE_URL}/teacher/review/${moduleKey}`, {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await page.waitForSelector('[data-testid="review-page"]', { timeout: 60000 });

  // FR5: the module actually reassembled from its three collections.
  const rendered = await page.evaluate(() => ({
    title: document.querySelector('[data-testid="review-module-title"]')?.textContent ?? "",
    lessons: document.querySelectorAll('[data-testid^="review-lesson-"]').length,
    exercises: document.querySelectorAll('[data-testid^="review-exercise-"]').length,
    answersShown: [...document.querySelectorAll('[data-testid^="review-exercise-answer-"]')].filter(
      (el) => el.value.trim().length > 0,
    ).length,
    criticVerdict:
      document.querySelector('[data-testid="critic-verdict"]')?.textContent?.trim() ?? "",
    scoresDisclaimer:
      document.querySelector('[data-testid="critic-panel"]')?.textContent?.includes(
        "לא תוצאות הערכה של המערכת",
      ) ?? false,
    referenceShown:
      document.querySelector('[data-testid="scores-reference"]')?.textContent?.trim() ?? "",
  }));
  record.rendered = rendered;
  check("module_reassembled", rendered.lessons > 0 && rendered.exercises > 0, rendered);
  check("teacher_sees_answers", rendered.answersShown > 0, rendered.answersShown);
  // R1: the panel must say the numbers are draft diagnostics, in the UI.
  check("r1_scores_copy_present", rendered.scoresDisclaimer === true);
  check("r1_reference_shown", rendered.referenceShown.length > 0, rendered.referenceShown);

  // FR5 edit through the real controlled editor.
  const originalHook = before.lessons[0].hook;
  record.originalHook = originalHook;
  record.newHook = NEW_HOOK;
  await setField(page, "review-lesson-hook-0", NEW_HOOK);
  const saveEnabled = await page.evaluate(
    () => !document.querySelector('[data-testid="review-save"]').disabled,
  );
  check("save_enabled_after_edit", saveEnabled === true);

  await page.click('[data-testid="review-save"]');
  await page.waitForSelector('[data-testid="review-save-notice"]', { timeout: 120000 });
  record.saveNotice = await page.$eval(
    '[data-testid="review-save-notice"]',
    (el) => el.textContent?.trim() ?? "",
  );

  // Acceptance: the edit is in Firestore, read back with the owner token.
  const after = await moduleDoc(moduleKey);
  check("edit_persisted", after.lessons[0].hook === NEW_HOOK, after.lessons[0].hook);

  // Acceptance: a memory bank record is visible in the emulator (FR6).
  const memoriesAfter = await listCollection("feedbackMemoryBank");
  const added = memoriesAfter.filter(
    (m) => !memoriesBefore.some((b) => b.id === m.id) && m.data.moduleKey === moduleKey,
  );
  record.memoryBank = {
    before: memoriesBefore.length,
    after: memoriesAfter.length,
    addedForThisModule: added.length,
    sample: added[0]
      ? {
          teacherKey: added[0].data.teacherKey,
          semanticDistance: added[0].data.semanticDistance,
          teacherModifications: added[0].data.teacherModifications,
          vectorLength: Array.isArray(added[0].data.adaptedContextVector)
            ? added[0].data.adaptedContextVector.length
            : 0,
        }
      : null,
  };
  check("memory_bank_record_written", added.length >= 1, record.memoryBank);
  check(
    "memory_record_holds_the_pair",
    Boolean(
      added[0] &&
        String(added[0].data.teacherModifications).includes(NEW_HOOK) &&
        String(added[0].data.teacherModifications).includes(originalHook),
    ),
  );
  check(
    "memory_record_has_embedding",
    Boolean(added[0] && (added[0].data.adaptedContextVector ?? []).length > 100),
  );

  // FR7 publish through the modal.
  await page.click('[data-testid="review-publish-open"]');
  await page.waitForSelector('[data-testid="publish-modal"][open]', { timeout: 30000 });
  await page.waitForFunction(
    () => document.querySelectorAll('[data-testid^="publish-student-"]').length > 0,
    { timeout: 30000 },
  );
  const chosen = await page.evaluate(() => {
    const boxes = [...document.querySelectorAll('[data-testid^="publish-student-"]')].slice(0, 2);
    boxes.forEach((box) => box.click());
    return boxes.map((box) => box.dataset.testid.replace("publish-student-", ""));
  });
  record.chosenStudents = chosen;
  check("publish_modal_lists_students", chosen.length === 2, chosen);

  await page.click('[data-testid="publish-confirm"]');
  await page.waitForSelector('[data-testid="review-publish-notice"]', { timeout: 60000 });
  record.publishNotice = await page.$eval(
    '[data-testid="review-publish-notice"]',
    (el) => el.textContent?.trim() ?? "",
  );

  // Acceptance: an assignment doc with assignedTo.
  const assignments = await listCollection("assignments");
  const mine = assignments.filter((a) => a.data.moduleKey === moduleKey);
  record.assignment = mine.length
    ? {
        assignmentId: mine[mine.length - 1].id,
        assignedTo: mine[mine.length - 1].data.assignedTo,
        teacherKey: mine[mine.length - 1].data.teacherKey,
        status: mine[mine.length - 1].data.status,
        publishedAt: mine[mine.length - 1].data.publishedAt,
      }
    : null;
  const assignment = mine[mine.length - 1]?.data;
  check(
    "assignment_created_with_assigned_to",
    Boolean(
      assignment &&
        Array.isArray(assignment.assignedTo) &&
        chosen.every((key) => assignment.assignedTo.includes(key)) &&
        assignment.teacherKey === "t1" &&
        assignment.status === "active",
    ),
    record.assignment,
  );

  // D11: the audience must reach the module and every exercise, or a
  // student can list the module and then fail to read its exercises.
  const published = await moduleDoc(moduleKey);
  check("module_marked_published", published.status === "published", published.status);
  check(
    "module_audience_denormalized",
    chosen.every((key) => (published.assignedStudentKeys ?? []).includes(key)),
    published.assignedStudentKeys,
  );

  const exerciseKeys = published.lessons.flatMap((lesson) => lesson.exerciseKeys);
  const exercises = await Promise.all(
    exerciseKeys.map(async (key) => ({
      key,
      data: plain({ mapValue: { fields: (await emu(`/exercises/${key}`)).fields } }),
    })),
  );
  record.exerciseAudit = {
    count: exercises.length,
    allHaveAudience: exercises.every((e) =>
      chosen.every((k) => (e.data.assignedStudentKeys ?? []).includes(k)),
    ),
    leaking: exercises
      .filter((e) => "correctAnswer" in e.data || "socraticHints" in e.data)
      .map((e) => e.key),
  };
  check("exercise_audience_denormalized", record.exerciseAudit.allHaveAudience, record.exerciseAudit);
  // R6 is a release blocker, so it is re checked after every write path.
  check("r6_no_answers_in_student_docs", record.exerciseAudit.leaking.length === 0, record.exerciseAudit.leaking);
} catch (err) {
  record.error = String(err);
  failures.push("threw");
} finally {
  await browser.close();
}

record.ok = failures.length === 0;
record.failures = failures;
if (!existsSync(dirname(OUT_PATH))) mkdirSync(dirname(OUT_PATH), { recursive: true });
writeFileSync(OUT_PATH, `${JSON.stringify(record, null, 2)}\n`);

for (const [name, result] of Object.entries(record.checks)) {
  console.log(`${result.ok ? "PASS" : "FAIL"}  ${name}`);
}
if (record.error) console.log(`\nerror: ${record.error}`);
console.log(
  record.ok
    ? "\nEdit, save, memory bank record and publish were all demonstrated, so the gate is MET."
    : `\nGate NOT met. Failed: ${failures.join(", ")}`,
);
console.log(`Written to ${OUT_PATH}`);
process.exit(record.ok ? 0 : 1);
