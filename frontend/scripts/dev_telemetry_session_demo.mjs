/**
 * Telemetry capture verification (Step 4.5, NFR5, NFR7).
 *
 * The step asks for a scripted three minute session that produces plausible
 * telemetryEvents in the emulator, with an idle stretch visibly excluded
 * from ATT accrual. This runs that session against the real workspace and
 * then reads the log back.
 *
 * The session has four phases and the phases are the evidence:
 *   quiet    the workspace is open and untouched, so nothing may accrue
 *   active   an interaction every few seconds, so beats accrue at 15s
 *   idle     95s untouched, longer than IDLE_CUTOFF_SECONDS, so the gap it
 *            leaves in the log is one the server side exclusion can see
 *   active   interaction resumes, so accrual resumes
 *
 * Interactions are dispatched as DOM events on window rather than typed on a
 * keyboard. CDP key and click input is not delivered to an authenticated
 * page in this rig, which is D19, measured in Step 4.2 and amended in Step
 * 4.3. The listener does not inspect isTrusted, so from the listener inwards
 * the path is identical. What this run does not prove is that a real
 * keystroke reaches window, which is the same residual D19 already records.
 *
 * A beat is either in Firestore or in the localStorage queue and never in
 * neither, so the accrual checks read the union of the two. The final checks
 * dispatch pagehide, which is a real flush trigger, and only then require
 * Firestore to hold everything.
 *
 * The fixture is created and deleted here, so this can run against an
 * emulator holding other work. Content is a short hand written Hebrew
 * exercise: no model is called and nothing here is evidence about
 * generation.
 *
 * Run from frontend/, with emulators, seeded users and a Next server up.
 * Under next dev request the routes once first, because a cold route
 * compiles on its first request:
 *   DEMO_SERVER="next dev" node scripts/dev_telemetry_session_demo.mjs
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
const AUTH = `http://localhost:9099/identitytoolkit.googleapis.com/v1/accounts`;
const OUT_PATH = resolve("../evaluation/results/dev_runs/telemetry_session.json");

const NAV = Number(process.env.DEMO_NAV_TIMEOUT_MS ?? 240000);

/** Mirrors lib/firebase/telemetry.ts. */
const BEAT_SECONDS = 15;
const QUEUE_KEY = "enrichment:pending-telemetry";
/** Mirrors backend/app/core/telemetry.py IDLE_CUTOFF_SECONDS. */
const IDLE_CUTOFF_SECONDS = 90;

/** Phase lengths in ms. The idle stretch is deliberately over the cutoff. */
const QUIET_MS = 20000;
const ACTIVE_ONE_MS = 50000;
const IDLE_MS = 95000;
const ACTIVE_TWO_MS = 45000;
const OFFLINE_MS = 35000;

const TEACHER = { uid: "t1", email: "teacher1@demo.school" };
const STUDENT = { uid: "s01", email: "student01@demo.school" };

const NONCE = Date.now().toString(36);
const TITLE = `זמן פעיל על משימה ${NONCE}`;
const PROMPT = "בכמה דרכים שונות אפשר לסדר שלושה ספרים שונים על מדף?";

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

/** Firestore REST typed value back to a plain JS value. */
function plain(field) {
  if (!field || typeof field !== "object") return undefined;
  if ("stringValue" in field) return field.stringValue;
  if ("integerValue" in field) return Number(field.integerValue);
  if ("doubleValue" in field) return field.doubleValue;
  if ("booleanValue" in field) return field.booleanValue;
  if ("timestampValue" in field) return field.timestampValue;
  if ("nullValue" in field) return null;
  if ("arrayValue" in field) return (field.arrayValue.values ?? []).map(plain);
  if ("mapValue" in field) {
    return Object.fromEntries(
      Object.entries(field.mapValue.fields ?? {}).map(([k, v]) => [k, plain(v)]),
    );
  }
  return undefined;
}

/** Every telemetry event in the log, as plain objects, newest last. */
async function readTelemetry() {
  const response = await fetch(`${FIRESTORE}/telemetryEvents?pageSize=300`, {
    headers: { Authorization: "Bearer owner" },
  });
  if (!response.ok) throw new Error(`read telemetryEvents: ${response.status}`);
  const body = await response.json();
  return (body.documents ?? [])
    .map((docu) => ({
      docId: docu.name.split("/").pop(),
      ...Object.fromEntries(
        Object.entries(docu.fields ?? {}).map(([k, v]) => [k, plain(v)]),
      ),
    }))
    .sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)));
}

/**
 * This run's events only. Filtering on the assignment key, which is a fresh
 * document id, keeps a leftover event from an earlier run out of every
 * count. Nothing else in the log can carry this key.
 */
function mine(events, assignmentKey) {
  return events.filter((event) => event.assignmentKey === assignmentKey);
}

/** A real end user ID token, for the checks that must not run as owner. */
async function idTokenFor(email) {
  const response = await fetch(`${AUTH}:signInWithPassword?key=fake-api-key`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: PASSWORD, returnSecureToken: true }),
  });
  if (!response.ok) throw new Error(`sign in ${email}: ${response.status}`);
  return (await response.json()).idToken;
}

// ---- Page helpers, D19 compliant on authenticated pages ----
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * One interaction, as the telemetry listener sees it. Dispatched on window
 * because that is where startTelemetrySession listens.
 */
async function interact(page) {
  await page.evaluate(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true }));
  });
}

/** Interact every `everyMs` for `totalMs`, which is what an engaged child looks like. */
async function interactFor(page, totalMs, everyMs = 3000) {
  const until = Date.now() + totalMs;
  while (Date.now() < until) {
    await interact(page);
    await wait(Math.min(everyMs, Math.max(0, until - Date.now())));
  }
}

async function readLocalQueue(page) {
  return page.evaluate((key) => {
    try {
      const raw = window.localStorage.getItem(key);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }, QUEUE_KEY);
}

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
  await page.waitForFunction((path) => location.pathname === path, { timeout: NAV }, landing);
}

const record = {
  label: "DEV demo evidence, not an evaluation result (R1)",
  harness: {
    server: process.env.DEMO_SERVER ?? "unspecified",
    navTimeoutMs: NAV,
    interactions:
      "DOM keydown dispatched on window. CDP key input is not delivered on an authenticated page in this rig (D19).",
    timerArgs:
      "Background timer throttling disabled, so a 15s interval in a headless page is not slowed by the browser.",
  },
  phases: {
    quietMs: QUIET_MS,
    activeOneMs: ACTIVE_ONE_MS,
    idleMs: IDLE_MS,
    activeTwoMs: ACTIVE_TWO_MS,
    offlineMs: OFFLINE_MS,
  },
  deferred:
    "hsrcCount is wired through recordHelpRequest and useTelemetry().recordHelp but no click drives it yet, because the Ask the tutor control is Step 4.6, where the guide places the HSR verification.",
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
  args: [
    "--no-first-run",
    "--no-default-browser-check",
    // Rig flags. A throttled interval would measure Chrome, not the design.
    "--disable-background-timer-throttling",
    "--disable-backgrounding-occluded-windows",
    "--disable-renderer-backgrounding",
  ],
});

const created = { moduleKey: null, exerciseKey: null, assignmentKey: null };
const consoleErrors = [];
const offlineNoise = [];
let offlineNow = false;
const OFFLINE_NOISE = /ERR_INTERNET_DISCONNECTED|ERR_NETWORK_CHANGED|ERR_NAME_NOT_RESOLVED/;

try {
  record.timestamp = new Date().toISOString();

  // ---- Fixture: one published exercise, assigned to one student ----
  created.moduleKey = await createDoc("curriculumModules", {
    title: TITLE,
    summary: "יחידה קצרה בכתיבת יד למדידת זמן פעיל. אין בה תוכן שנוצר במודל.",
    subject: "math",
    gradeLevel: "6",
    difficultyLevel: 3,
    creatorTeacherKey: TEACHER.uid,
    status: "active",
    assignedStudentKeys: [STUDENT.uid],
    createdAt: new Date(),
    weeklySequence: ["שבוע 1: צירופים"],
    lessons: [],
    assessment: null,
    exerciseCount: 1,
    lessonCount: 1,
  });

  created.exerciseKey = await createDoc("exercises", {
    moduleKey: created.moduleKey,
    order: 1,
    prompt: PROMPT,
    scaffoldSteps: ["כמה אפשרויות יש למקום הראשון?", "וכמה נשארו למקום השני?"],
    assignedStudentKeys: [STUDENT.uid],
  });

  created.assignmentKey = await createDoc("assignments", {
    moduleKey: created.moduleKey,
    teacherKey: TEACHER.uid,
    assignedTo: [STUDENT.uid],
    status: "active",
    publishedAt: new Date(),
    dueAt: null,
  });
  record.fixture = { ...created, title: TITLE };

  const before = (await readTelemetry()).length;
  record.telemetryBefore = before;

  // ---- The session ----
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    if (offlineNow && OFFLINE_NOISE.test(text)) offlineNoise.push(text);
    else consoleErrors.push(text);
  });
  page.on("pageerror", (error) => consoleErrors.push(String(error)));

  await login(page, STUDENT.email, "/student/dashboard");
  await page.goto(`${BASE_URL}/student/workspace/${created.assignmentKey}`, {
    waitUntil: "domcontentloaded",
    timeout: NAV,
  });
  await page.waitForSelector('[data-testid="workspace"]', { timeout: NAV });
  const sessionStart = Date.now();
  check("workspace_opens_for_the_fixture", true, { assignmentKey: created.assignmentKey });

  // A hidden page would beat never, so the run would prove nothing. State
  // the rig's own condition rather than assume it.
  const visibility = await page.evaluate(() => document.visibilityState);
  check("page_is_visible_so_beats_are_possible", visibility === "visible", { visibility });

  // Phase 1, quiet. Open, untouched, longer than a beat interval.
  await wait(QUIET_MS);
  const afterQuiet = await readLocalQueue(page);
  const quietEvents = mine(await readTelemetry(), created.assignmentKey).length;
  check(
    "an_untouched_workspace_accrues_nothing",
    afterQuiet.length === 0 && quietEvents === 0,
    { queued: afterQuiet.length, written: quietEvents, forMs: QUIET_MS },
  );

  // Phase 2, active.
  await interactFor(page, ACTIVE_ONE_MS);
  const afterActiveOne = await readLocalQueue(page);
  const writtenOne = mine(await readTelemetry(), created.assignmentKey).length;
  const accruedOne = afterActiveOne.length + writtenOne;
  check(
    "interaction_accrues_beats_at_the_designed_interval",
    accruedOne >= 2 && accruedOne <= 4,
    {
      beats: accruedOne,
      queued: afterActiveOne.length,
      written: writtenOne,
      expected: `2 to 4 over ${ACTIVE_ONE_MS / 1000}s at one per ${BEAT_SECONDS}s`,
    },
  );

  // Phase 3, idle. Nothing touched, page still visible.
  //
  // One beat still belongs to the active phase. The interval holding the
  // last keystroke is credited at its next tick, which can be up to one
  // interval after the typing stopped, so it lands just inside this window
  // by construction. The first run of this script read the boundary as a
  // failure when it was the design working: a keystroke buys its interval.
  // So let that beat land, then require the rest of the stretch to be
  // silent, which is the claim that actually matters.
  const GRACE_MS = BEAT_SECONDS * 1000 + 5000;
  await wait(GRACE_MS);
  const atIdleStart = (await readLocalQueue(page)).length + mine(await readTelemetry(), created.assignmentKey).length;
  await wait(IDLE_MS - GRACE_MS);
  const atIdleEnd = (await readLocalQueue(page)).length + mine(await readTelemetry(), created.assignmentKey).length;
  check("a_sustained_idle_stretch_accrues_nothing", atIdleEnd === atIdleStart, {
    beatsBefore: atIdleStart,
    beatsAfter: atIdleEnd,
    silentSeconds: (IDLE_MS - GRACE_MS) / 1000,
    graceSeconds: GRACE_MS / 1000,
    note: "The grace window is one beat interval plus slack, for the beat the last keystroke had already earned.",
  });

  // Phase 4, active again.
  await interactFor(page, ACTIVE_TWO_MS);

  // Phase 5, offline. Beats must survive in storage, not in memory.
  offlineNow = true;
  await page.setOfflineMode(true);
  const queueAtOffline = (await readLocalQueue(page)).length;
  const writtenAtOffline = mine(await readTelemetry(), created.assignmentKey).length;
  await interactFor(page, OFFLINE_MS);
  const offlineQueue = await readLocalQueue(page);
  const writtenDuringOffline =
    mine(await readTelemetry(), created.assignmentKey).length - writtenAtOffline;
  const queuedWhileOffline = offlineQueue.length - queueAtOffline;
  check(
    "beats_written_offline_wait_in_storage",
    queuedWhileOffline >= 1 && writtenDuringOffline === 0,
    {
      queuedWhileOffline,
      writtenDuringOffline,
      queueNow: offlineQueue.length,
      ids: offlineQueue.map((beat) => beat.eventId),
    },
  );
  const idsQueuedOffline = offlineQueue.map((beat) => beat.eventId);

  // Reconnect. The online listener flushes.
  await page.setOfflineMode(false);
  offlineNow = false;
  await interact(page);
  let landed = [];
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await wait(1500);
    const ids = new Set((await readTelemetry()).map((event) => event.eventId));
    landed = idsQueuedOffline.filter((id) => ids.has(id));
    if (landed.length === idsQueuedOffline.length) break;
  }
  check(
    "queued_beats_land_when_the_connection_returns",
    idsQueuedOffline.length > 0 && landed.length === idsQueuedOffline.length,
    { queued: idsQueuedOffline.length, landed: landed.length },
  );

  // pagehide is a real flush trigger, so the log holds everything after it.
  await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
  await wait(4000);
  const queueAtEnd = await readLocalQueue(page);
  const sessionSeconds = Math.round((Date.now() - sessionStart) / 1000);
  const events = mine(await readTelemetry(), created.assignmentKey);
  record.session = {
    wallClockSeconds: sessionSeconds,
    events: events.length,
    queueAtEnd: queueAtEnd.length,
  };
  check("the_queue_empties_once_everything_is_acknowledged", queueAtEnd.length === 0, {
    left: queueAtEnd.length,
  });

  // ---- What the log says ----
  const attTotal = events.reduce((sum, event) => sum + (event.attSeconds ?? 0), 0);
  record.accrual = {
    attSecondsTotal: attTotal,
    wallClockSeconds: sessionSeconds,
    excludedSeconds: sessionSeconds - attTotal,
    ratio: Number((attTotal / sessionSeconds).toFixed(3)),
  };
  check(
    "accrued_time_is_well_under_the_wall_clock",
    attTotal > 0 && attTotal < sessionSeconds,
    record.accrual,
  );

  const beatValues = [...new Set(events.map((event) => event.attSeconds))];
  check(
    "every_beat_is_one_interval_of_active_time",
    beatValues.every((seconds) => seconds === BEAT_SECONDS),
    { distinctAttSeconds: beatValues, expected: BEAT_SECONDS },
  );

  const stamps = events.map((event) => Date.parse(event.timestamp)).sort((a, b) => a - b);
  const gaps = stamps.slice(1).map((at, index) => Math.round((at - stamps[index]) / 1000));
  const widest = gaps.length > 0 ? Math.max(...gaps) : 0;
  record.gaps = { seconds: gaps, widest, cutoff: IDLE_CUTOFF_SECONDS };
  check(
    "the_idle_stretch_leaves_a_gap_the_server_cutoff_can_see",
    widest > IDLE_CUTOFF_SECONDS,
    { widest, cutoff: IDLE_CUTOFF_SECONDS },
  );

  const ownership = events.every(
    (event) =>
      event.studentKey === STUDENT.uid &&
      event.assignmentKey === created.assignmentKey &&
      event.exerciseKey === created.exerciseKey,
  );
  check("every_event_names_this_student_and_this_exercise", ownership, {
    events: events.length,
  });

  // NFR5. The field set is the contract and nothing else, and no value
  // carries anything that could identify a child.
  const CONTRACT = [
    "assignmentKey",
    "attSeconds",
    "eventId",
    "exerciseKey",
    "hsrcCount",
    "studentKey",
    "timestamp",
  ];
  const shapes = [
    ...new Set(
      events.map((event) =>
        Object.keys(event)
          .filter((key) => key !== "docId")
          .sort()
          .join(","),
      ),
    ),
  ];
  check(
    "events_carry_the_contract_fields_and_nothing_else",
    shapes.length === 1 && shapes[0] === CONTRACT.join(","),
    { shapes, expected: CONTRACT.join(",") },
  );

  const studentDoc = await (
    await fetch(`${FIRESTORE}/users/${STUDENT.uid}`, {
      headers: { Authorization: "Bearer owner" },
    })
  ).json();
  const displayName = plain(studentDoc.fields?.name) ?? "";
  const haystack = JSON.stringify(events);
  const pii = [
    ["email", haystack.includes("@")],
    ["display name", displayName.length > 0 && haystack.includes(displayName)],
    ["answer text", haystack.includes(PROMPT)],
  ].filter(([, hit]) => hit);
  check("no_pii_in_any_event", pii.length === 0, {
    checkedFor: ["@", displayName, "the exercise prompt"],
    hits: pii.map(([what]) => what),
  });

  // A replay cannot double count, measured as the student rather than owner.
  const token = await idTokenFor(STUDENT.email);
  const victim = events[0];
  const replay = await fetch(`${FIRESTORE}/telemetryEvents/${victim.docId}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      fields: fields({
        eventId: victim.eventId,
        studentKey: STUDENT.uid,
        exerciseKey: created.exerciseKey,
        assignmentKey: created.assignmentKey,
        attSeconds: 999,
        hsrcCount: 0,
        timestamp: victim.timestamp,
      }),
    }),
  });
  const after = await readTelemetry();
  const untouched = after.find((event) => event.docId === victim.docId);
  check(
    "a_replayed_beat_id_is_refused_by_the_log",
    replay.status === 403 && untouched?.attSeconds === BEAT_SECONDS,
    { status: replay.status, attSecondsStillIs: untouched?.attSeconds },
  );

  record.offlineNoise = { count: offlineNoise.length, sample: offlineNoise.slice(0, 2) };
  record.consoleErrors = consoleErrors;
  check("no_console_errors", consoleErrors.length === 0, consoleErrors.slice(0, 5));
  record.sampleEvents = events.slice(0, 3);
} catch (error) {
  record.error = String(error);
  failures.push("threw");
  console.error(`\nerror: ${error}\n`);
} finally {
  // Clean up the fixture and this run's events, so the emulator is left as
  // it was found. Telemetry documents are append only to every client, which
  // is why the owner credential is used here.
  let cleaned = 0;
  const paths = [];
  if (created.assignmentKey) paths.push(`/assignments/${created.assignmentKey}`);
  if (created.exerciseKey) paths.push(`/exercises/${created.exerciseKey}`);
  if (created.moduleKey) paths.push(`/curriculumModules/${created.moduleKey}`);
  if (created.assignmentKey) paths.push(`/studentProgress/${created.assignmentKey}__${STUDENT.uid}`);
  try {
    for (const event of await readTelemetry()) {
      if (event.studentKey === STUDENT.uid && event.assignmentKey === created.assignmentKey) {
        paths.push(`/telemetryEvents/${event.docId}`);
      }
    }
  } catch {
    // Nothing to enumerate.
  }
  for (const path of paths) {
    try {
      await emu(path, { method: "DELETE" });
      cleaned += 1;
    } catch {
      // Already gone.
    }
  }
  record.cleanedUp = cleaned;

  record.ok = failures.length === 0;
  record.failures = failures;
  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, `${JSON.stringify(record, null, 2)}\n`);

  for (const [name, result] of Object.entries(record.checks)) {
    console.log(`${result.ok ? "PASS" : "FAIL"}  ${name}`);
  }
  console.log(
    record.ok
      ? `\nA ${record.accrual?.wallClockSeconds}s session accrued ${record.accrual?.attSecondsTotal}s of active time, with the idle stretch excluded.`
      : `\nNOT verified. Failed: ${failures.join(", ")}`,
  );
  console.log(`Written to ${OUT_PATH}`);
  await browser.close();
  if (!existsSync(OUT_PATH)) process.exitCode = 1;
  else if (!record.ok) process.exitCode = 1;
}
