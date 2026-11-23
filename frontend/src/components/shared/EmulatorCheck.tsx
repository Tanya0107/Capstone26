"use client";

/**
 * Dev-only emulator connectivity probe (BUILD_GUIDE Step 1.2).
 * Performs one trivial Firestore read on mount so the emulator panel
 * shows a live connection. Renders nothing in production mode.
 */
import { useEffect, useState } from "react";
import { doc, getDoc } from "firebase/firestore";
import { db } from "@/lib/firebase/client";

export default function EmulatorCheck() {
  const [status, setStatus] = useState<"checking" | "connected" | "error">("checking");

  useEffect(() => {
    let cancelled = false;
    getDoc(doc(db, "healthcheck", "ping"))
      .then(() => {
        if (!cancelled) setStatus("connected");
      })
      .catch((err) => {
        // Permission denied still proves the emulator answered
        if (!cancelled) setStatus(err?.code === "permission-denied" ? "connected" : "error");
        if (err?.code !== "permission-denied") console.error("Emulator check failed", err);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (process.env.NEXT_PUBLIC_USE_EMULATORS !== "true") return null;
  return (
    <p className="text-sm text-gray-500" data-testid="emulator-check">
      Firestore emulator: {status}
    </p>
  );
}
