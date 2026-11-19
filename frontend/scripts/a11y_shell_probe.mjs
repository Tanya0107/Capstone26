/**
 * Verifies the two Step 4.1 acceptance criteria that a Lighthouse score
 * does not cover: keyboard focus must be visible, and reduced motion must
 * be respected.
 *
 * Both are claims about computed style under real conditions, so they are
 * measured in a real browser rather than asserted from the stylesheet.
 * Focus is driven with actual Tab presses, because :focus-visible only
 * engages for keyboard focus and a scripted element.focus() would not
 * prove what a keyboard user sees.
 *
 * Order matters here, and getting it wrong cost real time. An earlier
 * version ran focus diagnostics before the walk, calling focus() on the
 * body and on the first link to check whether focus was being stolen.
 * That manipulation left the sequential focus navigation starting point in
 * a state where Tab reported no movement at all, which looked exactly like
 * a broken tab order in the shell. The walk therefore runs first, on a
 * page whose focus nothing has touched, and every other measurement runs
 * after it.
 *
 * The breathing dot lives in LoadingIndicator, which no screen mounts
 * until Step 4.2. To test the token layer now, the probe injects a span
 * carrying animate-breathe into the live shell and reads its computed
 * animation under both motion preferences. That tests the same CSS the
 * component will use.
 *
 * Prerequisites and install are the same as scripts/lighthouse_shells.mjs.
 * Run from frontend/:
 *   node scripts/a11y_shell_probe.mjs
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import puppeteer from "puppeteer-core";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";
const CHROME_PATH =
  process.env.CHROME_PATH ??
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const DEMO_PASSWORD = process.env.DEMO_PASSWORD ?? "Demo1234";
const MIN_OUTLINE_PX = 3;
const OUT_PATH = resolve("../evaluation/results/dev_runs/a11y_shell_probe.json");

const SHELLS = [
  { role: "teacher", email: "teacher1@demo.school", path: "/teacher/dashboard" },
  { role: "student", email: "student01@demo.school", path: "/student/dashboard" },
];

async function signIn(page, shell) {
  // networkidle0 never fires here. The Firebase SDK keeps a long lived
  // connection to the emulators open, so the page is never network idle.
  // Waiting for the form itself is both faster and the real readiness signal.
  await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector('[data-testid="login-submit"]', { timeout: 60000 });
  await page.type('[data-testid="login-email"]', shell.email);
  await page.type('[data-testid="login-password"]', DEMO_PASSWORD);
  await page.click('[data-testid="login-submit"]');
  await page.waitForFunction(
    (expected) => window.location.pathname === expected,
    { timeout: 60000 },
    shell.path,
  );
  await page.waitForSelector('[data-testid="nav-brand"]', { timeout: 30000 });
}

/** Tab through the shell, reporting the focus ring on each stop. */
async function focusWalk(page, maxStops) {
  const stops = [];
  for (let index = 0; index < maxStops; index += 1) {
    await page.keyboard.press("Tab");
    const stop = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return null;
      const style = window.getComputedStyle(el);
      const box = el.getBoundingClientRect();
      return {
        tag: el.tagName.toLowerCase(),
        testid: el.getAttribute("data-testid"),
        label: (el.textContent ?? "").trim().slice(0, 40),
        outline_style: style.outlineStyle,
        outline_width: style.outlineWidth,
        outline_color: style.outlineColor,
        transform: style.transform,
      };
    });
    // Leaving the document ends the walk.
    if (stop === null) break;

    const width = Number.parseFloat(stop.outline_width);
    const entry = {
      ...stop,
      focus_ring_visible:
        stop.outline_style !== "none" &&
        Number.isFinite(width) &&
        width >= MIN_OUTLINE_PX,
    };

    // A walk that reports the same element twice has not advanced, and
    // counting it as two stops would turn a stuck tab order into a pass.
    const key = entry.testid ?? `${entry.tag}:${entry.label}`;
    const previous = stops.at(-1);
    if (previous && (previous.testid ?? `${previous.tag}:${previous.label}`) === key) {
      return { stops, advanced: false };
    }
    stops.push(entry);
  }
  return { stops, advanced: true };
}

/** The skip link starts translated off screen and slides back on focus, so
 * its settled box is what proves a keyboard user can actually see it. */
async function skipLinkOnFocus(page) {
  await page.evaluate(() => document.querySelector('a[href="#main"]')?.focus());
  return page.evaluate(
    () =>
      new Promise((resolve) => {
        const link = document.querySelector('a[href="#main"]');
        // Let the 150ms transition settle before measuring geometry.
        requestAnimationFrame(() =>
          setTimeout(() => {
            const box = link?.getBoundingClientRect();
            resolve({
              text: (link?.textContent ?? "").trim(),
              top: box ? Math.round(box.top) : null,
              visible_in_viewport: Boolean(box && box.top >= 0 && box.height > 0),
            });
          }, 300),
        );
      }),
  );
}

/** Computed animation and transition for the token layer's moving parts. */
async function motionSample(page) {
  return page.evaluate(() => {
    const probe = document.createElement("span");
    probe.className = "animate-breathe";
    document.body.appendChild(probe);
    const animation = window.getComputedStyle(probe);
    const skip = document.querySelector('a[href="#main"]');
    const skipStyle = skip ? window.getComputedStyle(skip) : null;
    const sample = {
      animation_name: animation.animationName,
      animation_duration: animation.animationDuration,
      animation_iteration_count: animation.animationIterationCount,
      skip_link_transition_duration: skipStyle ? skipStyle.transitionDuration : null,
    };
    probe.remove();
    return sample;
  });
}

const durationMs = (value) =>
  value.endsWith("ms") ? Number.parseFloat(value) : Number.parseFloat(value) * 1000;

async function probeRole(browser, shell) {
  const page = await browser.newPage();
  const console_errors = [];
  page.on("console", (message) => {
    if (message.type() === "error") console_errors.push(message.text().slice(0, 200));
  });
  page.on("pageerror", (error) =>
    console_errors.push(`pageerror: ${String(error).slice(0, 200)}`),
  );

  try {
    await signIn(page, shell);
    // Keyboard events only reach the document when the page is the front
    // tab. This is read only with respect to focus.
    await page.bringToFront();

    // The walk comes first. Nothing above has touched focus.
    const { stops: focus_stops, advanced: focus_advanced } = await focusWalk(page, 10);

    const skip_link = await skipLinkOnFocus(page);
    const motion_default = await motionSample(page);
    await page.emulateMediaFeatures([
      { name: "prefers-reduced-motion", value: "reduce" },
    ]);
    const motion_reduced = await motionSample(page);

    return {
      role: shell.role,
      path: shell.path,
      focus_stops,
      focus_advanced,
      reached_sign_out: focus_stops.some((stop) => stop.testid === "nav-signout"),
      skip_link_is_first_stop: Boolean(focus_stops[0]?.label?.startsWith("דלגו")),
      every_stop_has_a_visible_ring:
        focus_stops.length > 0 && focus_stops.every((stop) => stop.focus_ring_visible),
      skip_link,
      motion_default,
      motion_reduced,
      reduced_motion_respected:
        durationMs(motion_default.animation_duration) > 100 &&
        durationMs(motion_reduced.animation_duration) <= 1 &&
        motion_reduced.animation_iteration_count === "1",
      console_errors,
    };
  } finally {
    await page.close();
  }
}

async function main() {
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    // true means the modern headless mode. The string "new" was accepted by
    // older puppeteer and removed in v23, so it is avoided here.
    headless: true,
    args: ["--no-first-run", "--no-default-browser-check"],
  });

  const roles = [];
  try {
    // PROBE_REVERSE exists to tell a role specific failure apart from a
    // position specific one, which is how the tab order question above was
    // settled. Keep it.
    const order = process.env.PROBE_REVERSE === "1" ? [...SHELLS].reverse() : SHELLS;
    for (const shell of order) {
      roles.push(await probeRole(browser, shell));
    }
  } finally {
    await browser.close();
  }

  const focusOk = roles.every(
    (role) =>
      role.every_stop_has_a_visible_ring && role.focus_advanced && role.reached_sign_out,
  );
  const motionOk = roles.every((role) => role.reduced_motion_respected);
  const skipOk = roles.every(
    (role) => role.skip_link_is_first_stop && role.skip_link.visible_in_viewport,
  );

  const report = {
    label: "DEV measurement, not an evaluation result (R1)",
    measures:
      "BUILD_GUIDE Step 4.1 acceptance, keyboard focus visible and reduced motion respected",
    timestamp: new Date().toISOString(),
    base_url: BASE_URL,
    min_outline_px: MIN_OUTLINE_PX,
    roles,
    keyboard_focus_visible: focusOk,
    reduced_motion_respected: motionOk,
    skip_link_reachable_first: skipOk,
    gate_met: focusOk && motionOk && skipOk,
  };

  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  for (const role of roles) {
    console.log(
      `${role.role.padEnd(8)} stops=${role.focus_stops.length} advanced=${role.focus_advanced} signOut=${role.reached_sign_out} ring=${role.every_stop_has_a_visible_ring} skipFirst=${role.skip_link_is_first_stop} skipVisible=${role.skip_link.visible_in_viewport} reducedMotion=${role.reduced_motion_respected}`,
    );
    console.log(
      `         tab order: ${role.focus_stops.map((s) => s.testid ?? s.tag).join(" -> ")}`,
    );
  }
  console.log(`gate_met=${report.gate_met}`);
  console.log(`Written to ${OUT_PATH}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
