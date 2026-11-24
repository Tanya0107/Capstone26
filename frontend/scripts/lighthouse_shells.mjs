/**
 * Lighthouse measurement for the Step 4.1 acceptance criterion, performance
 * at or above 90 on both role shells as the NFR1 proxy.
 *
 * Why this is not a plain lighthouse command. Both shells sit behind
 * ProtectedRoute, so an unauthenticated audit is redirected to /login and
 * would quietly measure the wrong page while reporting a shell URL. This
 * script signs in to the Auth emulator with puppeteer first and then hands
 * Lighthouse the same browser, so the audit runs against the real
 * authenticated shell.
 *
 * Methodology caveat recorded in the output. The Firebase session lives in
 * IndexedDB, and Lighthouse clears storage before a run by default, which
 * would sign the browser out mid audit. The shell runs therefore set
 * disableStorageReset, so their scores describe a returning authenticated
 * visitor rather than a cold first visit. The public /login run is measured
 * the normal way, with storage reset on, as the cold cache reference.
 *
 * Prerequisites: a production build served by next start, the Firestore and
 * Auth emulators, and the seeded demo users.
 *
 * Tooling is installed without touching package.json so that CI, which runs
 * npm ci, stays lean:
 *   npm i --no-save lighthouse puppeteer-core
 * Run from frontend/:
 *   node scripts/lighthouse_shells.mjs
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import lighthouse from "lighthouse";
import puppeteer from "puppeteer-core";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";
const CHROME_PATH =
  process.env.CHROME_PATH ??
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const DEMO_PASSWORD = process.env.DEMO_PASSWORD ?? "Demo1234";
const TARGET_PERFORMANCE = 90;
const OUT_PATH = resolve(
  "../evaluation/results/dev_runs/lighthouse_shells.json",
);

const SHELLS = [
  { role: "teacher", email: "teacher1@demo.school", path: "/teacher/dashboard" },
  { role: "student", email: "student01@demo.school", path: "/student/dashboard" },
];

const AUDIT_KEYS = [
  "first-contentful-paint",
  "largest-contentful-paint",
  "total-blocking-time",
  "cumulative-layout-shift",
  "speed-index",
];

function score(categories, name) {
  const value = categories?.[name]?.score;
  return value === null || value === undefined ? null : Math.round(value * 100);
}

function metrics(audits) {
  const out = {};
  for (const key of AUDIT_KEYS) {
    out[key] = audits?.[key]?.displayValue ?? null;
  }
  return out;
}

/** Lighthouse options shared by every run, pinned so reruns are comparable. */
function options(port, disableStorageReset) {
  return {
    port,
    output: "json",
    logLevel: "error",
    onlyCategories: ["performance", "accessibility", "best-practices"],
    formFactor: "desktop",
    screenEmulation: { mobile: false, width: 1440, height: 900, deviceScaleFactor: 1, disabled: false },
    throttling: {
      rttMs: 40,
      throughputKbps: 10 * 1024,
      cpuSlowdownMultiplier: 1,
      requestLatencyMs: 0,
      downloadThroughputKbps: 0,
      uploadThroughputKbps: 0,
    },
    disableStorageReset,
  };
}

async function launch() {
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    // true means the modern headless mode. The string "new" was accepted by
    // older puppeteer and removed in v23, so it is avoided here.
    headless: true,
    args: ["--no-first-run", "--no-default-browser-check"],
  });
  const port = Number(new URL(browser.wsEndpoint()).port);
  return { browser, port };
}

async function signIn(browser, shell) {
  const page = await browser.newPage();
  // networkidle0 never fires here. The Firebase SDK keeps a long lived
  // connection to the emulators open, so the page is never network idle.
  // Waiting for the form itself is both faster and the real readiness signal.
  await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector('[data-testid="login-submit"]', { timeout: 60000 });
  await page.type('[data-testid="login-email"]', shell.email);
  await page.type('[data-testid="login-password"]', DEMO_PASSWORD);
  await page.click('[data-testid="login-submit"]');
  // Login routes to / and the root page re-routes by role, so wait for the
  // shell itself rather than for any navigation.
  await page.waitForFunction(
    (expected) => window.location.pathname === expected,
    { timeout: 60000 },
    shell.path,
  );
  await page.waitForSelector('[data-testid="nav-brand"]', { timeout: 30000 });
  await page.close();
}

/** Confirm the shell really rendered for this session rather than bouncing
 * to /login. A score for the wrong page is worse than no score. */
async function probeShell(browser, shell) {
  const page = await browser.newPage();
  try {
    await page.goto(`${BASE_URL}${shell.path}`, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    await page.waitForSelector('[data-testid="nav-brand"]', { timeout: 30000 });
    return await page.evaluate(() => ({
      pathname: window.location.pathname,
      nav_present: Boolean(document.querySelector('[data-testid="nav-brand"]')),
      main_landmarks: document.querySelectorAll("main").length,
      skip_link: document.querySelector('a[href="#main"]')?.textContent ?? null,
      role_theme: document.querySelector("[data-role]")?.getAttribute("data-role") ?? null,
    }));
  } finally {
    await page.close();
  }
}

async function auditShell(shell) {
  const { browser, port } = await launch();
  try {
    await signIn(browser, shell);
    const url = `${BASE_URL}${shell.path}`;
    const run = await lighthouse(url, options(port, true));
    const { categories, audits, lighthouseVersion, environment } = run.lhr;
    const probe = await probeShell(browser, shell);
    return {
      target: shell.role,
      url,
      final_url: run.lhr.finalDisplayedUrl,
      measured_the_shell:
        run.lhr.finalDisplayedUrl === url && probe.nav_present && probe.pathname === shell.path,
      probe,
      authenticated: true,
      storage_reset: false,
      storage_reset_note:
        "disabled because the Firebase session lives in IndexedDB, so this is a returning visitor, not a cold first visit",
      performance: score(categories, "performance"),
      accessibility: score(categories, "accessibility"),
      best_practices: score(categories, "best-practices"),
      metrics: metrics(audits),
      lighthouse_version: lighthouseVersion,
      user_agent: environment?.hostUserAgent ?? null,
    };
  } finally {
    await browser.close();
  }
}

async function auditPublicLogin() {
  const { browser, port } = await launch();
  try {
    const url = `${BASE_URL}/login`;
    const run = await lighthouse(url, options(port, false));
    const { categories, audits, lighthouseVersion, environment } = run.lhr;
    return {
      target: "login",
      url,
      final_url: run.lhr.finalDisplayedUrl,
      authenticated: false,
      storage_reset: true,
      storage_reset_note: "default Lighthouse behaviour, so this is a cold first visit",
      performance: score(categories, "performance"),
      accessibility: score(categories, "accessibility"),
      best_practices: score(categories, "best-practices"),
      metrics: metrics(audits),
      lighthouse_version: lighthouseVersion,
      user_agent: environment?.hostUserAgent ?? null,
    };
  } finally {
    await browser.close();
  }
}

async function main() {
  const runs = [];
  runs.push(await auditPublicLogin());
  for (const shell of SHELLS) {
    runs.push(await auditShell(shell));
  }

  const shellRuns = runs.filter((run) => run.authenticated);
  const below = shellRuns.filter(
    (run) =>
      run.performance === null ||
      run.performance < TARGET_PERFORMANCE ||
      !run.measured_the_shell,
  );
  const report = {
    label: "DEV measurement, not an evaluation result (R1)",
    measures:
      "BUILD_GUIDE Step 4.1 acceptance, Lighthouse performance on both role shells as the NFR1 proxy",
    timestamp: new Date().toISOString(),
    base_url: BASE_URL,
    target_performance: TARGET_PERFORMANCE,
    environment: "local production build via next start, Firebase emulators, seeded demo users",
    content_caveat:
      "Step 4.1 delivers the shells only. The pages inside them are still TODO stubs until Steps 4.2 to 4.6, so these scores describe the chrome, the token layer and the fonts, not a populated screen. Re-measure once real content lands.",
    runs,
    acceptance_gate:
      below.length === 0 && shellRuns.length === SHELLS.length
        ? `Both role shells scored at or above ${TARGET_PERFORMANCE} on performance, so the gate is MET.`
        : `${shellRuns.length - below.length} of ${SHELLS.length} role shells reached ${TARGET_PERFORMANCE} on performance, so the gate is NOT MET.`,
    gate_met: below.length === 0 && shellRuns.length === SHELLS.length,
  };

  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  for (const run of runs) {
    console.log(
      `${run.target.padEnd(8)} performance=${run.performance} accessibility=${run.accessibility} best-practices=${run.best_practices}`,
    );
  }
  console.log(report.acceptance_gate);
  console.log(`Written to ${OUT_PATH}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
