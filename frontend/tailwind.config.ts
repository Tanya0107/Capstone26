import type { Config } from "tailwindcss";

/**
 * Design tokens, Step 4.1 (warm academic direction).
 *
 * Every color resolves through a CSS variable declared in
 * src/styles/globals.css, so one class set serves both audiences. The
 * teacher theme is the default deep teal and the student theme overrides
 * the same variables with warm amber. Screens therefore never name a
 * palette, which is what keeps the two shells recognisably one product.
 *
 * Variables hold space separated RGB channels rather than hex so the
 * alpha value placeholder below keeps working, letting bg-ink/10 and
 * friends compose opacity the way the built in Tailwind colors do.
 */
const token = (variable: string) => `rgb(var(${variable}) / <alpha-value>)`;

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: { DEFAULT: token("--ink"), muted: token("--ink-muted") },
        surface: { DEFAULT: token("--surface"), sunken: token("--surface-sunken") },
        line: token("--line"),
        brand: {
          DEFAULT: token("--brand"),
          strong: token("--brand-strong"),
          soft: token("--brand-soft"),
          contrast: token("--brand-contrast"),
        },
        accent: token("--accent"),
        ok: token("--ok"),
        warn: token("--warn"),
        danger: token("--danger"),
      },
      fontFamily: {
        // Heebo and Assistant are drawn as Hebrew typefaces rather than
        // Latin families with Hebrew bolted on (D5). Loaded by next/font
        // in app/layout.tsx, which self hosts them so there is no third
        // party request and no swap driven layout shift (NFR1).
        display: ["var(--font-display)", "system-ui", "sans-serif"],
        body: ["var(--font-body)", "system-ui", "sans-serif"],
      },
      maxWidth: {
        // Teachers get a wide dense canvas, students a narrow reading
        // measure. Two numbers carry most of the density difference
        // between the audiences.
        shell: "80rem",
        reading: "56rem",
      },
      borderRadius: { card: "0.75rem" },
      boxShadow: {
        card: "0 1px 2px rgb(21 36 31 / 0.05), 0 8px 24px rgb(21 36 31 / 0.06)",
      },
      keyframes: {
        // The working stage breathes so a multi minute wait does not look
        // frozen (NFR8). Disabled under prefers-reduced-motion in globals.
        breathe: {
          "0%, 100%": { opacity: "1", transform: "scale(1)" },
          "50%": { opacity: "0.45", transform: "scale(0.82)" },
        },
      },
      animation: { breathe: "breathe 1.8s ease-in-out infinite" },
    },
  },
  plugins: [],
};
export default config;
