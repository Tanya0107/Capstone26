/**
 * Student dashboard and workspace verification (Step 4.4, FR9, FR10, FR13).
 *
 * This is the two browser demo the step asks for, run as two isolated
 * browser contexts so that one script can hold both ends. The teacher
 * publishes through the real Review Dashboard and the student, already
 * signed in and looking at an empty dashboard, must see the unit appear
 * with no reload.
 *
 * The contexts have to be isolated rather than two tabs. Firebase Auth
 * persists the session in IndexedDB per origin and syncs it across tabs of
 * one profile, so a teacher signing in to a second tab replaces the
 * student's session in the first, ProtectedRoute redirects that page away
 * and the live card can never arrive. The first run of this script failed
 * exactly that way, with the published assignment correct in Firestore and
 * no console error anywhere.
 *
 * What it proves, in order:
 *   a published unit reaches the student live (FR9, NFR3)
 *   its exercises load in order with their scaffold steps hidden (FR10)
 *   no answer and no hint from exerciseSolutions reaches this client (R6)
 *   scaffold steps open one at a time and never all at once
 *   the next exercise stays locked until an answer is sent
 *   an answer typed offline is on disk, not in memory, and survives a reload
 *   the queued submission reaches Firestore once the connection returns
 *   finishing the last exercise completes the assignment (FR13)
 *
 * The fixture is created and deleted by this script, so it can run against
 * an emulator holding other work without touching it. Content is a short
 * hand written Hebrew unit on purpose: no model is called, so nothing here
 * depends on API credit and nothing here is evidence about generation.
 *
 * Clicks and typing go through the element's own handlers, never CDP input
 * on an authenticated page (D19). Sign in on /login still uses real input.
 *
 * Run from frontend/, with emulators, seeded users and a Next server up,
 * either next start or next dev. Under next dev, request every route once
 * first, because a cold route compiles on its first request and that time
 * lands inside the browser's navigation timeout. Pass DEMO_SERVER so the
 * evidence file records which one served the run:
 *   DEMO_SERVER="next dev" node scripts/dev_student_workspace_demo.mjs
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
const OUT_PATH = resolve("../evaluation/results/dev_runs/student_workspace_demo.json");

/**
 * Navigation budget. Generous because a dev server compiles a route on first
 * request, and on a slow machine that is minutes rather than seconds. Routes
 * are pre warmed before the browser starts, so this is a safety margin and
 * not the normal path. It measures the rig, never the product.
 */
const NAV = Number(process.env.DEMO_NAV_TIMEOUT_MS ?? 240000);

const TEACHER = { uid: "t1", email: "teacher1@demo.school" };
const STUDENT = { uid: "s01", email: "student01@demo.school" };

const NONCE = Date.now().toString(36);
/** A string that cannot occur in student safe content. If the UI or the wire
 * ever carries it, an answer has leaked out of exerciseSolutions (R6). */
const CANARY = `LEAK-CANARY-${NONCE}`;
const TITLE = `חלוקה הוגנת של פיצה ${NONCE}`;

const OFFLINE_ANSWER = `תשובה שנכתבה בלי חיבור ${NONCE}`;

const EXERCISES = [
  {
    prompt: "פיצה חולקה ל-8 משולשים שווים. דנה אכלה 3 משולשים ויואב אכל 2. איזה חלק מהפיצה נשאר?",
    scaffoldSteps: [
      "כמה משולשים נאכלו בסך הכל?",
      "כמה משולשים נשארו מתוך 8?",
      "כתבו את התשובה כשבר, ופשטו אותו אם אפשר.",
    ],
    correctAnswer: `3/8 ${CANARY}`,
  },
  {
    prompt: "שתי פיצות זהות חולקו, הראשונה ל-4 חלקים והשנייה ל-6 חלקים. מי שלקח חלק אחד מהראשונה קיבל יותר או פחות ממי שלקח חלק אחד מהשנייה?",
    scaffoldSteps: [
      "מה גודל חלק אחד בכל פיצה?",
      "השוו בין שני השברים בעזרת מכנה משותף.",
    ],
    correctAnswer: `יותר, כי 1/4 גדול מ-1/6 ${CANARY}`,
  },
  {
    prompt: "חמישה חברים מתחלקים בשתי פיצות שוות. איזה חלק מפיצה מקבל כל אחד?",
    scaffoldSteps: [
      "כמה פיצות יש לחלק, וכמה חברים?",
      "כתבו את החלוקה כשבר.",
    ],
    correctAnswer: `2/5 ${CANARY}`,
  },
];

// ---- Firestore REST helpers ----
async function emu(path, init = {}) {
  const response = await fetch(`${FIRESTORE}${path}`, {
    ...init,
    headers: {
      Authorization: "Bearer owner",
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  if (!response.ok) {
    throw new Error(`emulator ${path}: ${response.status} ${await response.text()}`);
  }
  return response.status === 200 ? response.json() : {};
}

/** JS value to a Firestore REST typed value, for the fields this fixture uses. */
function value(raw) {
  if (raw === null || raw === undefined) return { nullValue: null };
  if (typeof raw === "string") return { stringValue: raw };
  if (typeof raw === "boolean") return { booleanValue: raw };
  if (typeof raw === "number") {
    return Number.isInteger(raw) ? { integerValue: String(raw) } : { doubleValue: raw };
  }
  if (Array.isArray(raw)) return { arrayValue: { values: raw.map(value) } };
  if (raw instanceof Date) return { timestampValue: raw.toISOString() };
  return { mapValue: { fields: fields(raw) } };
}

function fields(object) {
  return Object.fromEntries(Object.entries(object).map(([key, raw]) => [key, value(raw)]));
}

async function createDoc(collection, data) {
  const created = await emu(`/${collection}`, {
    method: "POST",
    body: JSON.stringify({ fields: fields(data) }),
  });
  return created.name.split("/").pop();
}

async function readDoc(path) {
  const response = await fetch(`${FIRESTORE}${path}`, {
    headers: { Authorization: "Bearer owner" },
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`read ${path}: ${response.status}`);
  return response.json();
}

// ---- Page helpers, D19 compliant on authenticated pages ----
async function tap(page, testid) {
  await page.$eval(`[data-testid="${testid}"]`, (el) => el.click());
}

async function setField(page, testid, text) {
  await page.$eval(
    `[data-testid="${testid}"]`,
    (el, next) => {
      const proto =
        el instanceof HTMLTextAreaElement
          ? HTMLTextAreaElement.prototype
          : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, "value").set.call(el, next);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    },
    text,
  );
}

/**
 * Sign in. Real keyboard and mouse input is used here because /login is
 * unauthenticated and D19 does not apply to it.
 *
 * The wait for React props is not ceremony. The submit button exists in the
 * server rendered markup before any handler is attached, and a click that
 * lands in that window submits the form natively as a GET, which looks
 * exactly like a failed sign in. Step 4.2 lost a run to this.
 */
async function login(page, email, landing) {
  await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded", timeout: NAV });
  await page.waitForSelector('[data-testid="login-submit"]', { timeout: NAV });
  await page.waitForFunction(
    () => {
      const el = document.querySelector('[data-testid="login-submit"]');
      return Boolean(el) && Object.keys(el).some((key) => key.startsWith("__reactProps$"));
    },
    { timeout: NAV, polling: 200 },
  );
  await page.type('[data-testid="login-email"]', email);
  await page.type('[data-testid="login-password"]', PASSWORD);
  await page.click('[data-testid="login-submit"]');
  await page.waitForFunction(
    (path) => location.pathname === path,
    { timeout: NAV },
    landing,
  );
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const record = {
  label: "DEV demo evidence, not an evaluation result (R1)",
  harness: {
    server: process.env.DEMO_SERVER ?? "unspecified",
    navTimeoutMs: NAV,
    note: "Timeouts are generous because the rig is slow. They measure the rig, not the product.",
  },
  fixture: { title: TITLE, exercises: EXERCISES.length },
  checks: {},
};
const failures = [];
const check = (name, ok, detail) => {
  record.checks[name] = { ok, ...(detail === undefined ? {} : { detail }) };
  if (!ok) failures.push(name);
};

const browser = await puppeteer.launch({
  executablePath: CHROME_PATH,
  headless: true,
  args: ["--no-first-run", "--no-default-browser-check"],
});

const created = { moduleKey: null, exerciseKeys: [], assignmentKey: null };
const consoleErrors = [];
/**
 * Console errors the browser emits because this script cut the connection.
 * Kept apart from real ones rather than filtered away, so the evidence says
 * how many there were and why they are not defects. Only network failures
 * raised while the page is deliberately offline qualify.
 */
const offlineNoise = [];
let offlineNow = false;
const OFFLINE_NOISE = /ERR_INTERNET_DISCONNECTED|ERR_NETWORK_CHANGED|ERR_NAME_NOT_RESOLVED/;
/** Every response body the student's page received, for the leak guard. */
const studentBodies = [];

try {
  record.timestamp = new Date().toISOString();

  // ---- Fixture: a draft unit the teacher has not published yet ----
  created.moduleKey = await createDoc("curriculumModules", {
    title: TITLE,
    summary: "יחידה קצרה בכתיבת יד לבדיקת מסך התלמיד. אין בה תוכן שנוצר במודל.",
    subject: "math",
    gradeLevel: "5",
    difficultyLevel: 3,
    creatorTeacherKey: TEACHER.uid,
    status: "draft",
    assignedStudentKeys: [],
    createdAt: new Date(),
    weeklySequence: ["שבוע 1: שברים בחיי היום יום"],
    lessons: [],
    assessment: null,
  });

  for (const [index, item] of EXERCISES.entries()) {
    const exerciseKey = await createDoc("exercises", {
      moduleKey: created.moduleKey,
      order: index + 1,
      prompt: item.prompt,
      scaffoldSteps: item.scaffoldSteps,
      assignedStudentKeys: [],
    });
    created.exerciseKeys.push(exerciseKey);
    // The paired teacher only document. Its answer carries the canary.
    await emu(`/exerciseSolutions/${exerciseKey}`, {
      method: "PATCH",
      body: JSON.stringify({
        fields: fields({
          exerciseKey,
          moduleKey: created.moduleKey,
          correctAnswer: item.correctAnswer,
          socraticHints: [{ hintOrder: 1, hintText: `רמז שאסור שיגיע לתלמיד ${CANARY}` }],
        }),
      }),
    });
  }

  // updateMask matters: a PATCH without one replaces the whole document, so
  // this would otherwise leave the module holding nothing but its lessons.
  await emu(`/curriculumModules/${created.moduleKey}?updateMask.fieldPaths=lessons`, {
    method: "PATCH",
    body: JSON.stringify({
      fields: fields({
        lessons: [
          {
            title: "שיעור 1: חלקים שווים",
            objectives: ["לזהות חלק מתוך שלם", "להשוות שברים פשוטים"],
            hook: "איך מחלקים פיצה בין חברים בלי לריב?",
            exerciseKeys: created.exerciseKeys.slice(0, 2),
          },
          {
            title: "שיעור 2: חלוקה בין חברים",
            objectives: ["לכתוב חלוקה כשבר"],
            hook: "שתי פיצות, חמישה חברים.",
            exerciseKeys: created.exerciseKeys.slice(2),
          },
        ],
      }),
    }),
  });
  record.fixture.moduleKey = created.moduleKey;
  record.fixture.exerciseKeys = created.exerciseKeys;

  // ---- The student, signed in and watching an empty dashboard ----
  const studentContext = await browser.createBrowserContext();
  const student = await studentContext.newPage();
  student.on("console", (m) => {
    if (m.type() !== "error") return;
    const text = m.text().slice(0, 180);
    if (offlineNow && OFFLINE_NOISE.test(text)) offlineNoise.push(text);
    else consoleErrors.push(`student: ${text}`);
  });
  student.on("pageerror", (e) => consoleErrors.push(`student pageerror: ${String(e).slice(0, 180)}`));
  student.on("response", async (response) => {
    try {
      const body = await response.text();
      if (body) studentBodies.push(body);
    } catch {
      // Redirects and empty bodies have nothing to search.
    }
  });

  await login(student, STUDENT.email, "/student/dashboard");
  await student.waitForSelector('[data-testid="student-dashboard"]', { timeout: NAV });
  await wait(1500);
  const before = await student.evaluate(() => ({
    cards: document.querySelectorAll('[data-testid^="assignment-card-"]').length,
    empty: Boolean(document.querySelector('[data-testid="student-dash-empty"]')),
    error: document.querySelector('[data-testid="student-dash-error"]')?.textContent ?? null,
  }));
  record.before = before;
  check("student_dashboard_loads_without_error", before.error === null, before);

  // ---- The teacher publishes, in another page, through the real UI ----
  const teacherContext = await browser.createBrowserContext();
  const teacher = await teacherContext.newPage();
  teacher.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(`teacher: ${m.text().slice(0, 180)}`);
  });
  await login(teacher, TEACHER.email, "/teacher/dashboard");
  await teacher.goto(`${BASE_URL}/teacher/review/${created.moduleKey}`, {
    waitUntil: "domcontentloaded",
    timeout: NAV,
  });
  await teacher.waitForSelector('[data-testid="review-page"]', { timeout: NAV });
  const reviewTitle = await teacher.$eval('[data-testid="review-module-title"]', (el) =>
    el.textContent?.trim() ?? "",
  );
  check("teacher_opens_the_fixture_for_review", reviewTitle === TITLE, reviewTitle);

  await tap(teacher, "review-publish-open");
  await teacher.waitForSelector('[data-testid="publish-modal"]', { timeout: 30000 });
  // The modal opens before its roster resolves, so wait for the student row
  // rather than for the dialog, or the clicks below land on a loading list.
  await teacher.waitForSelector(`[data-testid="publish-student-${STUDENT.uid}"]`, {
    timeout: NAV,
  });
  // The modal pre checks the current audience, so clearing first makes the
  // selection below an assertion about state rather than about clicks.
  await tap(teacher, "publish-clear-all");
  await tap(teacher, `publish-student-${STUDENT.uid}`);
  const selected = await teacher.$eval(
    `[data-testid="publish-student-${STUDENT.uid}"]`,
    (el) => el.checked,
  );
  check("teacher_selects_the_student", selected === true, { selected });
  await tap(teacher, "publish-confirm");
  await teacher
    .waitForSelector('[data-testid="review-publish-notice"]', { timeout: NAV })
    .catch(() => null);
  const publishFailure = await teacher
    .$eval('[data-testid="publish-failure"]', (el) => el.textContent?.trim() ?? "")
    .catch(() => null);
  check("publish_reports_no_failure", publishFailure === null, publishFailure);

  const assignments = await emu("/assignments?pageSize=300");
  const mine = (assignments.documents ?? []).filter(
    (d) => d.fields?.moduleKey?.stringValue === created.moduleKey,
  );
  created.assignmentKey = mine.length === 1 ? mine[0].name.split("/").pop() : null;
  record.assignmentKey = created.assignmentKey;
  check("publish_created_one_assignment", mine.length === 1, { found: mine.length });

  // ---- FR9 and NFR3: it must appear with no reload on the student page ----
  // Recorded because a lost student session is the failure mode this part of
  // the script is most likely to be wrong about.
  record.studentSessionDuringPublish = await student.evaluate(() => ({
    path: location.pathname,
    dashboardMounted: Boolean(document.querySelector('[data-testid="student-dashboard"]')),
  }));
  check(
    "student_session_survives_the_teacher_sign_in",
    record.studentSessionDuringPublish.path === "/student/dashboard" &&
      record.studentSessionDuringPublish.dashboardMounted,
    record.studentSessionDuringPublish,
  );

  const appeared = created.assignmentKey
    ? await student
        .waitForFunction(
          (key) => Boolean(document.querySelector(`[data-testid="assignment-card-${key}"]`)),
          { timeout: 30000 },
          created.assignmentKey,
        )
        .then(() => true)
        .catch(() => false)
    : false;
  check("assignment_appears_live_without_reload", appeared, {
    assignmentKey: created.assignmentKey,
    waitedMs: 30000,
    cardsBefore: before.cards,
  });

  const card = appeared
    ? await student.evaluate((key) => {
        const node = document.querySelector(`[data-testid="assignment-card-${key}"]`);
        return {
          text: node.textContent?.replace(/\s+/g, " ").trim().slice(0, 200) ?? "",
          href: node.querySelector("a")?.getAttribute("href") ?? null,
          progress:
            document.querySelector(`[data-testid="assignment-progress-${key}"]`)?.textContent ??
            null,
        };
      }, created.assignmentKey)
    : null;
  record.card = card;
  check(
    "card_shows_the_unit_and_opens_the_workspace",
    Boolean(card && card.text.includes(TITLE) && card.href === `/student/workspace/${created.assignmentKey}`),
    card,
  );

  // ---- FR10: into the workspace, through the card's own link ----
  await student.$eval(`[data-testid="assignment-open-${created.assignmentKey}"]`, (el) => el.click());
  // Wait for whichever state the workspace settles into, not only the good
  // one, so a refusal is reported as a refusal instead of as a timeout.
  const workspaceState = await student
    .waitForFunction(
      () => {
        const ids = [
          "workspace",
          "workspace-forbidden",
          "workspace-not_found",
          "workspace-unknown",
          "workspace-empty",
        ];
        for (const id of ids) {
          if (document.querySelector(`[data-testid="${id}"]`)) return id;
        }
        return false;
      },
      { timeout: NAV, polling: 300 },
    )
    .then((handle) => handle.jsonValue());
  record.workspaceState = workspaceState;
  check("workspace_opens_rather_than_refusing", workspaceState === "workspace", workspaceState);
  await student.waitForSelector('[data-testid="exercise-card"]', { timeout: NAV });
  await wait(600);

  const first = await student.evaluate(() => ({
    title: document.querySelector('[data-testid="workspace-title"]')?.textContent?.trim() ?? "",
    prompt: document.querySelector('[data-testid="exercise-prompt"]')?.textContent?.trim() ?? "",
    position: document.querySelector('[data-testid="exercise-position"]')?.textContent?.trim() ?? "",
    steps: document.querySelectorAll('[data-testid^="scaffold-step-"]').length,
    stepTotal: Number(document.querySelector('[data-testid="scaffold"]')?.dataset.total ?? -1),
    stepper: document.querySelectorAll('[data-testid^="exercise-step-"]').length,
    nextDisabled: document.querySelector('[data-testid="exercise-next"]')?.disabled ?? null,
    nextLocked: Boolean(document.querySelector('[data-testid="exercise-next-locked"]')),
  }));
  record.firstExercise = first;
  check(
    "workspace_opens_on_the_first_exercise_in_order",
    first.title === TITLE &&
      first.prompt === EXERCISES[0].prompt &&
      first.stepper === EXERCISES.length,
    first,
  );
  check(
    "scaffold_steps_start_hidden",
    first.steps === 0 && first.stepTotal === EXERCISES[0].scaffoldSteps.length,
    { rendered: first.steps, available: first.stepTotal },
  );
  check("next_is_locked_before_an_answer_is_sent", first.nextDisabled === true && first.nextLocked, {
    disabled: first.nextDisabled,
    noticeShown: first.nextLocked,
  });

  // Progressive disclosure: one step per request, never the whole recipe.
  await tap(student, "scaffold-reveal");
  await wait(250);
  const afterOne = await student.evaluate(() => ({
    steps: document.querySelectorAll('[data-testid^="scaffold-step-"]').length,
    firstStep: document.querySelector('[data-testid="scaffold-step-1"]')?.textContent ?? "",
  }));
  await tap(student, "scaffold-reveal");
  await wait(250);
  const afterTwo = await student.evaluate(
    () => document.querySelectorAll('[data-testid^="scaffold-step-"]').length,
  );
  record.scaffold = { afterOne: afterOne.steps, afterTwo };
  check(
    "scaffold_reveals_one_step_at_a_time",
    afterOne.steps === 1 && afterTwo === 2 && afterOne.firstStep.includes(EXERCISES[0].scaffoldSteps[0]),
    record.scaffold,
  );

  // ---- R6: nothing from exerciseSolutions may be here ----
  const domHasCanary = await student.evaluate(
    (needle) => document.documentElement.outerHTML.includes(needle),
    CANARY,
  );
  const wireHits = studentBodies.filter((body) => body.includes(CANARY)).length;
  record.leakGuard = { domHasCanary, wireHits, bodiesInspected: studentBodies.length };
  check("no_answer_text_in_the_student_dom", domHasCanary === false, { canary: CANARY });
  check(
    "no_answer_text_on_the_wire_to_the_student",
    wireHits === 0,
    { bodiesInspected: studentBodies.length },
  );

  // ---- Exercise 1, online ----
  await setField(student, "answer-input", `שלושה ועוד שניים הם חמישה, אז נשארו 3 מתוך 8 ${NONCE}`);
  await wait(200);
  await tap(student, "answer-submit");
  await student
    .waitForFunction(
      () =>
        document.querySelector('[data-testid="exercise-position"]')?.textContent?.includes("2") ??
        false,
      { timeout: 30000 },
    )
    .catch(() => null);
  await wait(1200);
  const progressAfterOne = await readDoc(
    `/studentProgress/${created.assignmentKey}__${STUDENT.uid}`,
  );
  record.progressAfterOne = {
    order: Number(progressAfterOne?.fields?.currentExerciseOrder?.integerValue ?? -1),
    startedAt: progressAfterOne?.fields?.startedAt?.timestampValue ?? null,
  };
  check(
    "submitting_advances_progress_in_firestore",
    record.progressAfterOne.order === 1 && Boolean(record.progressAfterOne.startedAt),
    record.progressAfterOne,
  );

  // ---- Exercise 2, with the connection cut (NFR7) ----
  const onSecond = await student.evaluate(
    () => document.querySelector('[data-testid="exercise-prompt"]')?.textContent?.trim() ?? "",
  );
  check("submitting_moves_to_the_next_exercise", onSecond === EXERCISES[1].prompt, {
    shown: onSecond.slice(0, 60),
  });

  offlineNow = true;
  await student.setOfflineMode(true);
  await setField(student, "answer-input", OFFLINE_ANSWER);
  await wait(300);
  // Counting the exact text, not the nonce: exercise 1's draft is still on
  // disk too and matching loosely would count it as well.
  const draftOnDisk = await student.evaluate(
    (text) =>
      Object.entries({ ...localStorage }).filter(
        ([name, stored]) => name.startsWith("enrichment:answer:") && stored === text,
      ).length,
    OFFLINE_ANSWER,
  );
  await tap(student, "answer-submit");
  await wait(1200);
  const offlineState = await student.evaluate(() => ({
    queue: localStorage.getItem("enrichment:pending-progress"),
    banner: document.querySelector('[data-testid="pending-banner"]')?.textContent?.trim() ?? null,
    online: navigator.onLine,
  }));
  record.offline = { draftOnDisk, ...offlineState };
  check("answer_is_on_disk_while_offline", draftOnDisk === 1 && offlineState.online === false, {
    draftsFound: draftOnDisk,
    online: offlineState.online,
  });
  const queued = offlineState.queue ? JSON.parse(offlineState.queue) : [];
  check(
    "unsent_submission_is_queued_durably",
    queued.length === 1 && queued[0].currentExerciseOrder === 2 && Boolean(offlineState.banner),
    { queued, banner: offlineState.banner },
  );

  // ---- Back online, then a reload, which is where an in memory queue dies ----
  await student.setOfflineMode(false);
  const drained = await student
    .waitForFunction(() => !localStorage.getItem("enrichment:pending-progress"), { timeout: 30000 })
    .then(() => true)
    .catch(() => false);
  await wait(800);
  offlineNow = false;
  const progressAfterTwo = await readDoc(
    `/studentProgress/${created.assignmentKey}__${STUDENT.uid}`,
  );
  record.progressAfterTwo = Number(
    progressAfterTwo?.fields?.currentExerciseOrder?.integerValue ?? -1,
  );
  check(
    "queued_submission_reaches_firestore_when_the_connection_returns",
    drained && record.progressAfterTwo === 2,
    { drained, order: record.progressAfterTwo },
  );

  await student.reload({ waitUntil: "domcontentloaded", timeout: NAV });
  await student.waitForSelector('[data-testid="exercise-card"]', { timeout: NAV });
  await wait(1200);
  await tap(student, "exercise-step-2");
  await wait(400);
  const afterReload = await student.evaluate(() => ({
    answer: document.querySelector('[data-testid="answer-input"]')?.value ?? "",
    prompt: document.querySelector('[data-testid="exercise-prompt"]')?.textContent?.trim() ?? "",
    state: document.querySelector('[data-testid="answer-status"]')?.dataset.answerState ?? "",
  }));
  record.afterReload = { ...afterReload, answer: afterReload.answer.slice(0, 80) };
  check(
    "offline_answer_survives_the_reload",
    afterReload.answer === OFFLINE_ANSWER && afterReload.prompt === EXERCISES[1].prompt,
    record.afterReload,
  );

  // ---- Exercise 3 completes the unit (FR13) ----
  await tap(student, "exercise-step-3");
  await wait(400);
  await setField(student, "answer-input", `שתי פיצות לחמישה חברים, כל אחד מקבל 2/5 ${NONCE}`);
  await wait(200);
  await tap(student, "answer-submit");
  const completed = await student
    .waitForSelector('[data-testid="progress-completed"]', { timeout: 30000 })
    .then(() => true)
    .catch(() => false);
  await wait(1200);
  const finalProgress = await readDoc(
    `/studentProgress/${created.assignmentKey}__${STUDENT.uid}`,
  );
  const summary = await student.evaluate(() => ({
    submitted: document.querySelector('[data-testid="progress-submitted"]')?.textContent ?? "",
    gainsNote: Boolean(document.querySelector('[data-testid="progress-gains-note"]')),
  }));
  record.final = {
    order: Number(finalProgress?.fields?.currentExerciseOrder?.integerValue ?? -1),
    isCompleted: finalProgress?.fields?.isCompleted?.booleanValue ?? null,
    completedAt: finalProgress?.fields?.completedAt?.timestampValue ?? null,
    completionShown: completed,
    summary,
  };
  check(
    "finishing_the_last_exercise_completes_the_assignment",
    record.final.order === EXERCISES.length &&
      record.final.isCompleted === true &&
      Boolean(record.final.completedAt) &&
      completed,
    record.final,
  );
  check(
    "progress_screen_states_where_a_gain_figure_comes_from",
    summary.gainsNote === true && summary.submitted === String(EXERCISES.length),
    summary,
  );

  // ---- R10: no sideways scroll at phone width ----
  await student.setViewport({ width: 390, height: 844 });
  await wait(800);
  const narrow = await student.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    return {
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: vw,
      overflowing: [...document.querySelectorAll("*")].filter(
        (el) => el.getBoundingClientRect().width > vw + 1,
      ).length,
      dir: document.documentElement.dir,
    };
  });
  record.phoneWidth = narrow;
  check(
    "no_horizontal_overflow_at_phone_width",
    narrow.overflowing === 0 && narrow.dir === "rtl",
    narrow,
  );
  record.offlineNoise = { count: offlineNoise.length, sample: offlineNoise.slice(0, 2) };
  check("no_console_errors", consoleErrors.length === 0, {
    unexpected: consoleErrors.slice(0, 3),
    offlineInduced: offlineNoise.length,
  });
} catch (err) {
  record.error = String(err);
  record.stack = err instanceof Error ? String(err.stack).split("\n").slice(0, 4) : null;
  failures.push("threw");
} finally {
  // This script's fixture is this script's litter. KEEP_FIXTURE leaves it in
  // place so a failed run can be inspected in the emulator afterwards.
  const bin = [];
  if (process.env.KEEP_FIXTURE) {
    record.keptFixture = { ...created };
    bin.length = 0;
  }
  if (created.assignmentKey) bin.push(`/assignments/${created.assignmentKey}`);
  if (created.assignmentKey) bin.push(`/studentProgress/${created.assignmentKey}__${STUDENT.uid}`);
  for (const key of created.exerciseKeys) {
    bin.push(`/exercises/${key}`, `/exerciseSolutions/${key}`);
  }
  if (created.moduleKey) bin.push(`/curriculumModules/${created.moduleKey}`);
  if (!process.env.KEEP_FIXTURE) {
    for (const path of bin) {
      await emu(path, { method: "DELETE" }).catch(() => undefined);
    }
  }
  record.cleanedUp = bin.length;
  await browser.close();
}

record.consoleErrors = consoleErrors.slice(0, 10);
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
    ? "\nA teacher's publish reached the student live, the unit was solved end to end, and an answer written offline survived a reload."
    : `\nNOT verified. Failed: ${failures.join(", ")}`,
);
console.log(`Written to ${OUT_PATH}`);
process.exit(record.ok ? 0 : 1);
