/** Redirects unauthenticated users to /login and wrong-role users to their home (NFR4). */
"use client";

export default function ProtectedRoute(
  { role, children }: { role: "teacher" | "student"; children: React.ReactNode }
) {
  // TODO Phase 2, Step 2.4
  return <>{children}</>;
}
