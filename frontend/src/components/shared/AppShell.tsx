/**
 * Role shell: skip link, banner, nav and the main landmark (Step 4.1).
 *
 * data-role is what switches the token theme declared in globals.css, so
 * the teal teacher surface and the amber student surface come out of one
 * class set. Pages inside the shell style themselves with semantic tokens
 * (bg-surface, text-ink, border-line) and never name a color.
 *
 * The skip link is the first focusable element on every authenticated
 * page, which is what makes the nav skippable for keyboard and screen
 * reader users instead of a wall they cross on every navigation.
 */
import type { Role } from "@/types/models";
import NavBar from "./NavBar";
import { strings } from "./strings";

export default function AppShell({
  role,
  children,
}: {
  role: Role;
  children: React.ReactNode;
}) {
  const dense = role === "teacher";
  return (
    <div data-role={role} className="min-h-dvh bg-surface-sunken">
      <a
        href="#main"
        className="absolute start-4 top-0 z-50 -translate-y-full rounded-b-card bg-brand px-4 py-2 font-medium text-brand-contrast transition-transform focus-visible:translate-y-0"
      >
        {strings.skipToContent}
      </a>

      <header className="border-b border-line bg-surface">
        <NavBar role={role} />
      </header>

      <main
        id="main"
        className={`mx-auto w-full px-4 ${dense ? "max-w-shell py-6" : "max-w-reading py-10"}`}
      >
        {children}
      </main>
    </div>
  );
}
