/**
 * Firebase client initialization (Auth + Firestore).
 * Emulator wiring is controlled by NEXT_PUBLIC_USE_EMULATORS (Phase 1).
 */
import { initializeApp, getApps } from "firebase/app";
import { getAuth, connectAuthEmulator } from "firebase/auth";
import { getFirestore, connectFirestoreEmulator } from "firebase/firestore";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
};

const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

if (process.env.NEXT_PUBLIC_USE_EMULATORS === "true" && typeof window !== "undefined") {
  // Guard against double-connect during Fast Refresh
  // @ts-expect-error private flag
  if (!auth._emu) {
    connectAuthEmulator(auth, "http://localhost:9099", { disableWarnings: true });
    connectFirestoreEmulator(db, "localhost", 8080);
    // @ts-expect-error private flag
    auth._emu = true;
  }
}
