/** Redirects unauthenticated users to /login and wrong role users to their home (NFR4). */
"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/hooks/useAuth";
import type { Role } from "@/types/models";

const homeByRole: Record<Role, string> = {
  teacher: "/teacher/dashboard",
  student: "/student/dashboard",
};

export default function ProtectedRoute({
  role,
  children,
}: {
  role: Role;
  children: React.ReactNode;
}) {
  const { user, role: userRole, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (!user || !userRole) {
      router.replace("/login");
    } else if (userRole !== role) {
      router.replace(homeByRole[userRole]);
    }
  }, [loading, user, userRole, role, router]);

  if (loading || !user || userRole !== role) return null;
  return <>{children}</>;
}
