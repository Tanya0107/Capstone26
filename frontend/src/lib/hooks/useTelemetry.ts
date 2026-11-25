/** Thin React wrapper around lib/firebase/telemetry session lifecycle. */
"use client";

import { useCallback, useEffect } from "react";
import { recordHelpRequest, startTelemetrySession } from "@/lib/firebase/telemetry";
import { useAuth } from "@/lib/hooks/useAuth";

/**
 * Runs one telemetry session for as long as this exercise is the open one.
 *
 * The session is keyed on the signed in user as well as the two keys,
 * because startTelemetrySession reads auth.currentUser and does nothing
 * without it. A mount that happened while auth was still resolving would
 * otherwise never start accruing.
 *
 * The returned stop function is the effect cleanup, so moving to the next
 * exercise, leaving the workspace and unmounting all flush what they hold.
 */
export function useTelemetry(assignmentKey: string, exerciseKey: string) {
  const { user } = useAuth();
  const studentKey = user?.uid ?? "";

  useEffect(() => {
    if (!studentKey || !assignmentKey || !exerciseKey) return;
    return startTelemetrySession(assignmentKey, exerciseKey);
  }, [studentKey, assignmentKey, exerciseKey]);

  // Bound to the open exercise for Step 4.6, so the bot's send handler does
  // not have to know which one that is.
  const recordHelp = useCallback(() => {
    if (exerciseKey) recordHelpRequest(exerciseKey);
  }, [exerciseKey]);

  return { recordHelp };
}
