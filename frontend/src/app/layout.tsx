import type { Metadata } from "next";
import { Assistant, Heebo } from "next/font/google";
import "@/styles/globals.css";

export const metadata: Metadata = {
  title: "פלטפורמת העשרה",
  description: "AI assisted enrichment programs. Braude capstone 26-2-D-7",
};

// next/font self hosts both families at build time, so there is no request
// to a third party and no font swap shifting the layout, both of which the
// NFR1 Lighthouse proxy for Step 4.1 measures.
const display = Heebo({
  subsets: ["hebrew", "latin"],
  weight: ["500", "700"],
  variable: "--font-display",
  display: "swap",
});

const body = Assistant({
  subsets: ["hebrew", "latin"],
  weight: ["400", "600"],
  variable: "--font-body",
  display: "swap",
});

// UI language is Hebrew with RTL layout (docs/DECISIONS.md D5).
// Phase 4 rule: use Tailwind logical properties (ps, pe, ms, me, start, end)
// instead of left and right so layouts stay correct in RTL.
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="he" dir="rtl" className={`${display.variable} ${body.variable}`}>
      <body className="bg-surface font-body text-ink antialiased">{children}</body>
    </html>
  );
}
