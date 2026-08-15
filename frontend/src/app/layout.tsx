import type { Metadata } from "next";
import "@/styles/globals.css";

export const metadata: Metadata = {
  title: "פלטפורמת העשרה",
  description: "AI assisted enrichment programs. Braude capstone 26-2-D-7",
};

// UI language is Hebrew with RTL layout (docs/DECISIONS.md D5).
// Phase 4 rule: use Tailwind logical properties (ps, pe, ms, me, start, end)
// instead of left and right so layouts stay correct in RTL.
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="he" dir="rtl">
      <body>{children}</body>
    </html>
  );
}
