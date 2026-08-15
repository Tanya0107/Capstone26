import type { Config } from "tailwindcss";

// NOTE Phase 4: define the real design tokens here per the design pass
// (palette, display + body typefaces) — do not ship Tailwind defaults.
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: { extend: {} },
  plugins: [],
};
export default config;
