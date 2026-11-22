/**
 * Teacher dashboard verification (Q13, D20).
 *
 * Checks the two things the screen exists for: a teacher can reach a
 * module they created, and a module that appears in Firestore while the
 * page is open shows up without a reload, which is what makes an orphan
 * draft recoverable.
 *
 * The live check writes a module doc straight into the emulator with the
 * owner token, which is exactly the shape an orphaned generation leaves
 * behind: persisted by the server, with no browser holding its key.
 *
 * Clicks go through the element's own handler, never CDP (D19).
 *
 * Run from frontend/, with emulators, seeded users and next start up:
 *   node scripts/dev_teacher_dashboard_demo.mjs
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
const OUT_PATH = resolve("../evaluation/results/dev_runs/teacher_dashboard_demo.json");
const ORPHAN_TITLE = `יחידה שנותרה ללא בעלים ${Date.now()}`;

async function emu(path, init = {}) {
  const response = await fetch(`${FIRESTORE}${path}`, {
    ...init,
    headers: { Authorization: "Bearer owner", "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  if (!response.ok) throw new Error(`emulator ${path}: ${response.status} ${await response.text()}`);
  return response.json();
}

async function tap(page, testid) {
  await page.$eval(`[data-testid="${testid}"]`, (el) => el.click());
}

/** A module doc shaped like one an abandoned generation leaves behind. */
async function writeOrphan() {
  const body = {
    fields: {
      title: { stringValue: ORPHAN_TITLE },
      subject: { stringValue: "math" },
      gradeLevel: { stringValue: "5" },
      difficultyLevel: { integerValue: "3" },
      creatorTeacherKey: { stringValue: "t1" },
      status: { stringValue: "draft" },
      assignedStudentKeys: { arrayValue: { values: [] } },
      createdAt: { timestampValue: new Date().toISOString() },
      weeklySequence: { arrayValue: { values: [] } },
      lessons: {
        arrayValue: {
          values: [
            {
              mapValue: {
                fields: {
                  title: { stringValue: "שיעור יחיד" },
                  objectives: { arrayValue: { values: [] } },
                  hook: { stringValue: "" },
                  exerciseKeys: { arrayValue: { values: [] } },
                },
              },
            },
          ],
        },
      },
    },
  };
  const created = await emu("/curriculumModules", { method: "POST", body: JSON.stringify(body) });
  return created.name.split("/").pop();
}

const record = { label: "DEV demo evidence, not an evaluation result (R1)", checks: {} };
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
const page = await browser.newPage();
const consoleErrors = [];
page.on("console", (m) => {
  if (m.type() === "error") consoleErrors.push(m.text().slice(0, 180));
});
page.on("pageerror", (e) => consoleErrors.push("pageerror: " + String(e).slice(0, 180)));

let orphanKey = null;
try {
  record.timestamp = new Date().toISOString();

  // What the teacher actually owns, straight from Firestore.
  const all = await emu("/curriculumModules?pageSize=300");
  const mine = (all.documents ?? []).filter(
    (d) => d.fields?.creatorTeacherKey?.stringValue === "t1",
  );
  const expected = {
    total: mine.length,
    draft: mine.filter((d) => d.fields.status?.stringValue === "draft").length,
    published: mine.filter((d) => d.fields.status?.stringValue === "published").length,
  };
  record.expected = expected;

  await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector('[data-testid="login-submit"]', { timeout: 60000 });
  await page.type('[data-testid="login-email"]', "teacher1@demo.school");
  await page.type('[data-testid="login-password"]', PASSWORD);
  await page.click('[data-testid="login-submit"]');
  await page.waitForFunction(() => location.pathname === "/teacher/dashboard", { timeout: 60000 });
  await page.waitForSelector('[data-testid="module-list"]', { timeout: 60000 });
  await new Promise((r) => setTimeout(r, 1200));

  const shown = await page.evaluate(() => ({
    cards: document.querySelectorAll('[data-testid^="module-card-"]').length,
    all: document.querySelector('[data-testid="dash-filter-all"]')?.textContent ?? "",
    draft: document.querySelector('[data-testid="dash-filter-draft"]')?.textContent ?? "",
    published: document.querySelector('[data-testid="dash-filter-published"]')?.textContent ?? "",
    firstLink:
      document.querySelector('[data-testid^="module-open-"]')?.getAttribute("href") ?? null,
    hasCreate: Boolean(document.querySelector('[data-testid="dash-create"]')),
  }));
  record.shown = shown;
  const n = (text) => Number((text.match(/\((\d+)\)/) ?? [])[1] ?? -1);

  // FR5: a teacher can see and reach their own modules.
  check("lists_only_my_modules", shown.cards === expected.total, { shown: shown.cards, expected });
  check(
    "filter_counts_match_firestore",
    n(shown.all) === expected.total &&
      n(shown.draft) === expected.draft &&
      n(shown.published) === expected.published,
    { all: n(shown.all), draft: n(shown.draft), published: n(shown.published), expected },
  );
  check(
    "card_links_to_review",
    Boolean(shown.firstLink && shown.firstLink.startsWith("/teacher/review/")),
    shown.firstLink,
  );
  check("create_entry_present", shown.hasCreate === true);

  // Filtering to drafts must change what is listed, or the control is a lie.
  await tap(page, "dash-filter-published");
  await new Promise((r) => setTimeout(r, 400));
  const publishedOnly = await page.evaluate(() => ({
    cards: document.querySelectorAll('[data-testid^="module-card-"]').length,
    empty: Boolean(document.querySelector('[data-testid="dash-empty-filtered"]')),
  }));
  record.publishedOnly = publishedOnly;
  check(
    "filter_narrows_the_list",
    publishedOnly.cards === expected.published ||
      (expected.published === 0 && publishedOnly.empty),
    { got: publishedOnly, expected: expected.published },
  );
  await tap(page, "dash-filter-all");
  await new Promise((r) => setTimeout(r, 400));

  // Q13: a module persisted while the page is open must appear by itself.
  // This is the orphan case, and a reload here would prove nothing.
  orphanKey = await writeOrphan();
  record.orphanKey = orphanKey;
  const appeared = await page
    .waitForFunction(
      (key) => Boolean(document.querySelector(`[data-testid="module-card-${key}"]`)),
      { timeout: 20000 },
      orphanKey,
    )
    .then(() => true)
    .catch(() => false);
  check("orphan_module_appears_live", appeared, { orphanKey, waitedMs: 20000 });

  const orphanCard = appeared
    ? await page.evaluate(
        (key) => {
          const card = document.querySelector(`[data-testid="module-card-${key}"]`);
          return {
            text: card.textContent?.replace(/\s+/g, " ").trim().slice(0, 160) ?? "",
            href: card.querySelector("a")?.getAttribute("href") ?? null,
          };
        },
        orphanKey,
      )
    : null;
  record.orphanCard = orphanCard;
  check(
    "orphan_is_reachable",
    Boolean(orphanCard && orphanCard.href === `/teacher/review/${orphanKey}`),
    orphanCard,
  );

  // Navigating there through the real link, not by typing a URL.
  if (appeared) {
    await page.$eval(`[data-testid="module-open-${orphanKey}"]`, (el) => el.click());
    const landed = await page
      .waitForFunction((key) => location.pathname === `/teacher/review/${key}`, { timeout: 20000 }, orphanKey)
      .then(() => true)
      .catch(() => false);
    await page.waitForSelector('[data-testid="review-page"]', { timeout: 30000 }).catch(() => null);
    const title = await page
      .$eval('[data-testid="review-module-title"]', (el) => el.textContent?.trim() ?? "")
      .catch(() => null);
    record.navigated = { landed, title };
    check("link_opens_the_review_screen", landed && title === ORPHAN_TITLE, record.navigated);
  }

  // R10: no sideways scroll at phone width.
  await page.goto(`${BASE_URL}/teacher/dashboard`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector('[data-testid="module-list"]', { timeout: 60000 });
  await page.setViewport({ width: 390, height: 844 });
  await new Promise((r) => setTimeout(r, 800));
  const narrow = await page.evaluate(() => {
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
  check("no_horizontal_overflow_at_phone_width", narrow.overflowing === 0 && narrow.dir === "rtl", narrow);
  check("no_console_errors", consoleErrors.length === 0, consoleErrors.slice(0, 3));
} catch (err) {
  record.error = String(err);
  failures.push("threw");
} finally {
  // The orphan fixture is this script's litter, not the project's data.
  if (orphanKey) {
    await emu(`/curriculumModules/${orphanKey}`, { method: "DELETE" }).catch(() => undefined);
    record.orphanCleanedUp = true;
  }
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
    ? "\nA teacher can reach their own modules and an orphaned draft appears live, so Q13 is closed."
    : `\nNOT verified. Failed: ${failures.join(", ")}`,
);
console.log(`Written to ${OUT_PATH}`);
process.exit(record.ok ? 0 : 1);
