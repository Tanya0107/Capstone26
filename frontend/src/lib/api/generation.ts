/**
 * Client for POST /backend/api/generation (FR1 -> FR4).
 * NFR8: caller must render a staged loading indicator while awaiting
 * (the pipeline legitimately takes seconds).
 * NFR7: on timeout/5xx, surface a retriable error and keep the form state.
 */
import type { CurriculumPackage, GenerationRequest } from "@/types/models";

export async function generateCurriculum(
  req: GenerationRequest,
  idToken: string
): Promise<CurriculumPackage> {
  const res = await fetch("/backend/api/generation", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
    body: JSON.stringify(req),
  });
  if (!res.ok) throw new Error(`Generation failed: ${res.status}`);
  return res.json();
}
