/**
 * Auth state hook (NFR4). Exposes { user, role, schoolKey, idToken, loading }.
 * Role and schoolKey come from custom claims set at provisioning, with a
 * users doc fallback. onIdTokenChanged keeps the token fresh across
 * refreshes.
 *
 * schoolKey is here because GenerationRequest requires it (FR1) and the
 * claim is its only authoritative source. Letting a screen invent one
 * would attach a module to the wrong school.
 */
"use client";

import { useEffect, useState } from "react";
import { onIdTokenChanged, type User } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { auth, db } from "@/lib/firebase/client";
import type { Role } from "@/types/models";

export interface AuthState {
  user: User | null;
  role: Role | null;
  schoolKey: string | null;
  idToken: string | null;
  loading: boolean;
}

const signedOut: AuthState = {
  user: null,
  role: null,
  schoolKey: null,
  idToken: null,
  loading: false,
};

export function useAuth(): AuthState {
  const [state, setState] = useState<AuthState>({ ...signedOut, loading: true });

  useEffect(() => {
    return onIdTokenChanged(auth, async (user) => {
      if (!user) {
        setState(signedOut);
        return;
      }
      try {
        const tokenResult = await user.getIdTokenResult();
        let role = (tokenResult.claims.role as Role | undefined) ?? null;
        let schoolKey = (tokenResult.claims.schoolKey as string | undefined) ?? null;
        if (!role || !schoolKey) {
          // One read covers both fallbacks rather than one read each.
          const snapshot = await getDoc(doc(db, "users", user.uid));
          const profile = snapshot.data();
          role = role ?? ((profile?.role as Role | undefined) ?? null);
          schoolKey = schoolKey ?? ((profile?.schoolKey as string | undefined) ?? null);
        }
        setState({ user, role, schoolKey, idToken: tokenResult.token, loading: false });
      } catch (err) {
        console.error("Failed to resolve auth role", err);
        setState({ user, role: null, schoolKey: null, idToken: null, loading: false });
      }
    });
  }, []);

  return state;
}
