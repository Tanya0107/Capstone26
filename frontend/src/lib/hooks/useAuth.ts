/**
 * Auth state hook (NFR4). Exposes { user, role, idToken, loading }.
 * Role comes from custom claims set at provisioning, with a users doc
 * fallback. onIdTokenChanged keeps the token fresh across refreshes.
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
  idToken: string | null;
  loading: boolean;
}

const signedOut: AuthState = { user: null, role: null, idToken: null, loading: false };

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
        if (!role) {
          const snapshot = await getDoc(doc(db, "users", user.uid));
          role = (snapshot.data()?.role as Role | undefined) ?? null;
        }
        setState({ user, role, idToken: tokenResult.token, loading: false });
      } catch (err) {
        console.error("Failed to resolve auth role", err);
        setState({ user, role: null, idToken: null, loading: false });
      }
    });
  }, []);

  return state;
}
