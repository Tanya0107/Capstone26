/**
 * Client for the Socratic bot (FR11). Streaming variant consumes SSE tokens
 * for low TTFT (NFR8, book §Challenges #2).
 */
import type { TutorTurnRequest, TutorTurnResponse } from "@/types/models";

export async function tutorTurn(req: TutorTurnRequest, idToken: string): Promise<TutorTurnResponse> {
  throw new Error("Implement in Phase 4, Step 4.6");
}

export async function* tutorTurnStream(
  req: TutorTurnRequest,
  idToken: string
): AsyncGenerator<string> {
  // TODO Phase 4: fetch /backend/api/tutor/turn/stream, parse SSE chunks, yield tokens.
  throw new Error("Implement in Phase 4, Step 4.6");
}
