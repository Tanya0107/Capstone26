/**
 * Auth context hook — exposes { user, role, idToken, loading } and enforces
 * role-based routing (NFR4): teachers -> /teacher/*, students -> /student/*.
 */
"use client";

export function useAuth() {
  // TODO Phase 2, Step 2.4: onAuthStateChanged + users/{uid} role fetch
  // (or custom claims), token refresh, and typed return.
  throw new Error("Implement in Phase 2, Step 2.4");
}
