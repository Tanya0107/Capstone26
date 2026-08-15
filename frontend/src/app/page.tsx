/** Root: redirect by auth state -> /login, /teacher/dashboard, /student/dashboard. */
"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/hooks/useAuth";

export default function Home() {
  const { user, role, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (!user || !role) router.replace("/login");
    else if (role === "teacher") router.replace("/teacher/dashboard");
    else router.replace("/student/dashboard");
  }, [loading, user, role, router]);

  return <main className="p-8" data-testid="root-redirect" />;
}
