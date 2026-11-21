/**
 * Step 4.2 acceptance: the happy path and the timeout path of the Goals
 * screen, driven through the real UI against the real backend.
 *
 * The acceptance asks for both paths demoed, so this records them instead
 * of relying on someone having clicked once. It drives the actual form, so
 * it also exercises the catalog fetch, the controlled form state and the
 * NFR7 error UI rather than just the HTTP contract, which the pytest suite
 * already covers.
 *
 * Modes:
 *   timeout  expects a 504. Start uvicorn with a tiny budget, for example
 *            GENERATION_TIMEOUT_SECONDS=5, so the orchestrator trips its
 *            own budget. The check that matters is NFR7: a retriable error
 *            is shown and the form still holds everything that was typed.
 *   happy    expects a real generation, minutes long, and a route to the
 *            Review Dashboard for the persisted module.
 *
 * Prerequisites: emulators, seeded users, uvicorn, and a built frontend
 * served by next start. Install tooling with
 *   npm i --no-save puppeteer-core
 * Run from frontend/:
 *   node scripts/dev_goals_screen_demo.mjs timeout
 *   node scripts/dev_goals_screen_demo.mjs happy
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import puppeteer from "puppeteer-core";

const MODE = process.argv[2] ?? "timeout";
const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";
const CHROME_PATH =
  process.env.CHROME_PATH ??
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const DEMO_PASSWORD = process.env.DEMO_PASSWORD ?? "Demo1234";
const OUT_PATH = resolve("../evaluation/results/dev_runs/goals_screen_demo.json");

// Deliberately above the 900s server budget so an overrun is recorded as
// the server's own 504 rather than a client give up.
const HAPPY_TIMEOUT_MS = 960_000;
const TIMEOUT_MODE_TIMEOUT_MS = 180_000;
// Must match strings.errorTimeoutTitle, so a 504 shown through the generic
// server error branch is not mistaken for the timeout path.
const TIMEOUT_TITLE = "היצירה חרגה ממסגרת הזמן";

const FILLED = {
  subject: "math",
  grade: "5",
  goals: "להעמיק את תחושת השבר דרך הקשרים מהמטבח ומהחיים",
  topics: ["שברים", "מכנה משותף"],
  difficulty: 3,
  standardsHint: "חיבור וחיסור שברים עם מכנים שונים",
};

async function signIn(page) {
  await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector('[data-testid="login-submit"]', { timeout: 60000 });
  await page.type('[data-testid="login-email"]', "teacher1@demo.school");
  await page.type('[data-testid="login-password"]', DEMO_PASSWORD);
  await page.click('[data-testid="login-submit"]');
  await page.waitForFunction(() => window.location.pathname === "/teacher/dashboard", {
    timeout: 60000,
  });
}

/** What the catalog rendered, which is the D8 guard reaching the UI. */
async function readCatalog(page) {
  await page.waitForSelector('[data-testid="goals-form"]', { timeout: 60000 });
  return page.evaluate(() => {
    const options = [...document.querySelectorAll('[data-testid="goals-subject"] option')]
      .map((o) => o.value)
      .filter(Boolean);
    return { subjects: options };
  });
}

async function gradesFor(page) {
  return page.evaluate(() =>
    [...document.querySelectorAll('[data-testid="goals-grade"] option')]
      .map((o) => o.value)
      .filter(Boolean),
  );
}

/**
 * Set a text field the way React expects, through the native value setter
 * so React's own value tracker sees a real change and onChange receives
 * the whole string.
 *
 * Why not type it. On any authenticated page in this app a plain input
 * loses keystrokes, including a vanilla non React input injected into the
 * page, while the same input on /login is fine. That is an open defect
 * recorded in docs/prompt_log.md and it predates this step, so typing key
 * by key here would make the acceptance demo fail for a reason that has
 * nothing to do with the Goals screen. This still drives the real onChange
 * handlers, the real validation and the real submit path.
 */
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

async function fillForm(page) {
  await page.select('[data-testid="goals-subject"]', FILLED.subject);
  // The grade select is populated from the chosen subject, so wait for it.
  await page.waitForFunction(
    () =>
      document.querySelectorAll('[data-testid="goals-grade"] option').length > 1,
    { timeout: 15000 },
  );
  const grades = await gradesFor(page);
  await page.select('[data-testid="goals-grade"]', FILLED.grade);
  await setField(page, "goals-text", FILLED.goals);
  for (const topic of FILLED.topics) {
    await setField(page, "goals-topic-input", topic);
    // Enter is handled by the form's own onKeyDown, so the chip is added
    // by the component rather than by this script.
    await page.click('[data-testid="goals-topic-add"]');
  }
  await setField(page, "goals-standards-hint", FILLED.standardsHint);
  await page.click(`[data-testid="goals-difficulty-${FILLED.difficulty}"]`);

  // Fail loudly if the form does not hold what we meant to enter, rather
  // than submitting a half filled form and reporting a confusing result.
  const state = await readFormState(page);
  if (!sameFormState(state)) {
    throw new Error(
      `form did not accept the input: ${JSON.stringify(state)} wanted ${JSON.stringify(FILLED)}`,
    );
  }
  return grades;
}

/** Everything the teacher typed, read back off the live form (NFR7). */
async function readFormState(page) {
  return page.evaluate(() => {
    const value = (id) => document.querySelector(`[data-testid="${id}"]`)?.value ?? null;
    const topics = [
      ...document.querySelectorAll('[data-testid="goals-topic-list"] li span'),
    ].map((n) => n.textContent?.trim());
    const difficulty = [1, 2, 3, 4, 5].find(
      (level) => document.querySelector(`[data-testid="goals-difficulty-${level}"]`)?.checked,
    );
    return {
      subject: value("goals-subject"),
      grade: value("goals-grade"),
      goals: value("goals-text"),
      standardsHint: value("goals-standards-hint"),
      topics,
      difficulty: difficulty ?? null,
    };
  });
}

function sameFormState(state) {
  return (
    state.subject === FILLED.subject &&
    state.grade === FILLED.grade &&
    state.goals === FILLED.goals &&
    state.standardsHint === FILLED.standardsHint &&
    state.difficulty === FILLED.difficulty &&
    JSON.stringify(state.topics) === JSON.stringify(FILLED.topics)
  );
}

async function run() {
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: true,
    args: ["--no-first-run", "--no-default-browser-check"],
  });
  const page = await browser.newPage();
  const statuses = [];
  page.on("response", (response) => {
    if (response.url().includes("/api/generation")) {
      // The method matters. Calling the backend directly makes the browser
      // send a CORS preflight to the same URL, and that OPTIONS answers
      // 200, so matching on the URL alone picks up the preflight and reads
      // a successful generation where there was a 504.
      statuses.push({
        method: response.request().method(),
        url: response.url().replace(BASE_URL, ""),
        status: response.status(),
      });
    }
  });

  const record = { mode: MODE, timestamp: new Date().toISOString() };
  try {
    await signIn(page);
    await page.goto(`${BASE_URL}/teacher/create`, { waitUntil: "domcontentloaded" });

    const catalog = await readCatalog(page);
    record.catalog_subjects = catalog.subjects;
    record.grades_offered_for_subject = await fillForm(page);
    record.form_before_submit = await readFormState(page);

    const startedAt = Date.now();
    await page.click('[data-testid="goals-submit"]');

    // The staged loader must appear while the request is in flight (NFR8).
    record.staged_loader_shown = await page
      .waitForSelector('[data-testid="loading-indicator"]', { timeout: 20000 })
      .then(() => true)
      .catch(() => false);
    record.loader_stages = await page.evaluate(() =>
      [...document.querySelectorAll('[data-testid^="loading-stage-"]')].map((n) =>
        n.getAttribute("data-testid"),
      ),
    );

    if (MODE === "happy") {
      await page.waitForFunction(
        () => window.location.pathname.startsWith("/teacher/review/"),
        { timeout: HAPPY_TIMEOUT_MS },
      );
      record.wall_seconds = Number(((Date.now() - startedAt) / 1000).toFixed(2));
      record.final_path = new URL(page.url()).pathname;
      record.module_key = record.final_path.split("/").pop();
      record.routed_to_review = true;
      record.generation_status =
        statuses.find(
          (entry) => entry.method === "POST" && entry.url.endsWith("/api/generation"),
        )?.status ?? null;
      record.ok = Boolean(record.module_key) && record.staged_loader_shown;
    } else {
      await page.waitForSelector('[data-testid="generation-error"]', {
        timeout: TIMEOUT_MODE_TIMEOUT_MS,
      });
      record.wall_seconds = Number(((Date.now() - startedAt) / 1000).toFixed(2));
      record.error_title = await page.$eval(
        '[data-testid="generation-error"] h2',
        (n) => n.textContent?.trim() ?? null,
      );
      record.retry_offered = Boolean(await page.$('[data-testid="generation-retry"]'));
      // The whole point of NFR7: the form came back filled in.
      record.form_after_timeout = await readFormState(page);
      record.form_state_preserved = sameFormState(record.form_after_timeout);
      record.still_on_create_page = new URL(page.url()).pathname === "/teacher/create";
      // The acceptance is the timeout path specifically, so a 504 is part
      // of it. An earlier version of this script only required some
      // retriable error with the form intact, and passed on a bare 500
      // raised by a model call that outran the budget, which is the exact
      // NFR7 gap it was meant to catch.
      // Generation now goes straight to the backend origin, so match the
      // POST explicitly rather than the first response on that URL.
      const generationPost = statuses.find(
        (entry) => entry.method === "POST" && entry.url.endsWith("/api/generation"),
      );
      record.generation_status = generationPost?.status ?? null;
      record.served_504 = generationPost?.status === 504;
      record.timeout_ui_shown = record.error_title === TIMEOUT_TITLE;
      record.ok =
        record.served_504 &&
        record.timeout_ui_shown &&
        record.retry_offered &&
        record.form_state_preserved &&
        record.still_on_create_page &&
        record.staged_loader_shown;
    }
    record.generation_responses = statuses;
  } catch (error) {
    record.ok = false;
    record.failure = String(error).slice(0, 300);
    record.generation_responses = statuses;
  } finally {
    await browser.close();
  }

  const report = existsSync(OUT_PATH)
    ? JSON.parse(readFileSync(OUT_PATH, "utf8"))
    : {
        label: "DEV demo evidence, not an evaluation result (R1)",
        measures:
          "BUILD_GUIDE Step 4.2 acceptance, happy path and timeout path of the Goals screen through the real UI and backend",
        runs: {},
      };
  report.runs[MODE] = record;
  report.acceptance_gate =
    report.runs.happy?.ok && report.runs.timeout?.ok
      ? "Both the happy path and the timeout path were demonstrated end to end, so the gate is MET."
      : `happy=${report.runs.happy?.ok ?? "not run"}, timeout=${report.runs.timeout?.ok ?? "not run"}, so the gate is NOT MET.`;
  report.gate_met = Boolean(report.runs.happy?.ok && report.runs.timeout?.ok);

  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  console.log(JSON.stringify(record, null, 2));
  console.log(report.acceptance_gate);
  console.log(`Written to ${OUT_PATH}`);
  if (!record.ok) process.exitCode = 1;
}

run();
