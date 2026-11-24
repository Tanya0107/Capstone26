/**
 * Role aware navigation for both shells (Step 4.1).
 *
 * One component serves teachers and students because the only real
 * differences are the link set and the density. Duplicating it would
 * duplicate the sign out path and the active link logic, which is where
 * RTL and accessibility bugs hide.
 *
 * Only routes that exist are linked. FR13 history and the per module
 * review route are reached from their own screens in later steps, not
 * from here, so this nav never points at a 404.
 */
"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { signOut } from "firebase/auth";
import { auth } from "@/lib/firebase/client";
import type { Role } from "@/types/models";
import { strings } from "./strings";

interface NavItem {
  href: string;
  label: string;
}

const itemsByRole: Record<Role, NavItem[]> = {
  teacher: [
    { href: "/teacher/dashboard", label: strings.teacherDashboard },
    { href: "/teacher/create", label: strings.teacherCreate },
    { href: "/teacher/analytics", label: strings.teacherAnalytics },
  ],
  student: [{ href: "/student/dashboard", label: strings.studentDashboard }],
};

export default function NavBar({ role }: { role: Role }) {
  const dense = role === "teacher";
  const pathname = usePathname();
  const router = useRouter();
  const [leaving, setLeaving] = useState(false);

  async function onSignOut() {
    setLeaving(true);
    try {
      await signOut(auth);
      router.replace("/login");
    } catch (err) {
      console.error("Sign out failed", err);
      setLeaving(false);
    }
  }

  return (
    <nav
      aria-label={dense ? strings.teacherNavLabel : strings.studentNavLabel}
      className={`mx-auto flex w-full items-center gap-2 px-4 ${
        dense ? "max-w-shell py-3" : "max-w-reading py-5"
      }`}
    >
      <span
        className={`font-display font-bold text-brand ${dense ? "text-lg" : "text-xl"}`}
        data-testid="nav-brand"
      >
        {strings.productName}
      </span>

      <ul className={`flex items-center ${dense ? "gap-1 ps-4" : "gap-2 ps-6"}`}>
        {itemsByRole[role].map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                data-testid={`nav-link-${item.href}`}
                className={`block rounded-card px-3 font-medium transition-colors ${
                  dense ? "py-1.5 text-sm" : "py-2.5 text-base"
                } ${
                  active
                    ? "bg-brand-soft text-brand-strong"
                    : "text-ink-muted hover:bg-surface-sunken hover:text-ink"
                }`}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>

      <button
        type="button"
        onClick={onSignOut}
        disabled={leaving}
        data-testid="nav-signout"
        className={`ms-auto rounded-card border border-line font-medium text-ink-muted transition-colors hover:border-brand hover:text-brand disabled:opacity-50 ${
          dense ? "px-3 py-1.5 text-sm" : "px-4 py-2.5 text-base"
        }`}
      >
        {leaving ? strings.signingOut : strings.signOut}
      </button>
    </nav>
  );
}
