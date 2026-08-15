/**
 * Client-side telemetry capture (feeds ATT / TCV / HSR — book §Metrics).
 *
 * Design (Phase 4, Step 4.5):
 *  - Heartbeat every 15s while the workspace tab is focused and the student
 *    has interacted since the last beat (keystroke/pointer) -> att accrual.
 *  - Idle gaps > IDLE_CUTOFF are excluded client-side AND server-side.
 *  - Every "Ask the tutor" click increments hsrcCount for that exercise.
 *  - Batched writes to telemetryEvents; NFR7 — on network failure, buffer to
 *    localStorage and flush on reconnect (never lose progress).
 *  - NFR5 — payloads contain keys only, never names or emails.
 */
export function startTelemetrySession(assignmentKey: string, exerciseKey: string): () => void {
  throw new Error("Implement in Phase 4, Step 4.5");
}

export function recordHelpRequest(exerciseKey: string): void {
  throw new Error("Implement in Phase 4, Step 4.5");
}
