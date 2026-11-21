/**
 * Client for the generation routes (FR1 to FR4).
 *
 * NFR8: the caller must render a staged loading indicator while awaiting,
 * since the pipeline legitimately takes minutes, not seconds.
 * NFR7: a timeout must surface as a retriable error with the form state
 * intact, which is why failures here are typed rather than thrown as bare
 * Errors. A caller cannot decide whether to offer a retry from a string.
 */
import type {
  CurriculumPackage,
  GenerationRequest,
  SubjectCatalog,
} from "@/types/models";

/**
 * Deliberately longer than the server's own NFR2b budget of 900s. The
 * orchestrator enforces that budget internally and answers with a 504
 * carrying retriable: true. If the client gave up first, an overrun would
 * look like a network failure and the retriable signal would be lost.
 */
export const CLIENT_TIMEOUT_MS = 960_000;

/**
 * Generation does not go through the Next rewrite in next.config.mjs.
 *
 * Measured: that proxy answers 500 at exactly 30.00s, every time, for any
 * upstream slower than 30s. A generation legitimately runs 4 to 11 minutes
 * (evaluation/results/dev_runs/summary.json), so through the proxy the
 * happy path can never arrive, and neither can the NFR7 504, since the
 * proxy's own 500 replaces it well before the server's budget expires.
 *
 * NEXT_PUBLIC_BACKEND_ORIGIN therefore sends these two calls to the
 * backend directly. CORS already allows the frontend origin
 * (settings.frontend_origin). With the variable unset the calls fall back
 * to the proxy path, which keeps a single origin for short requests and is
 * fine for anything under 30s.
 */
const BACKEND_ORIGIN = process.env.NEXT_PUBLIC_BACKEND_ORIGIN ?? "";

function backendUrl(path: string): string {
  return BACKEND_ORIGIN ? `${BACKEND_ORIGIN}${path}` : `/backend${path}`;
}

export type GenerationErrorKind =
  | "timeout"
  | "validation"
  | "forbidden"
  | "network"
  | "server";

export class GenerationError extends Error {
  readonly kind: GenerationErrorKind;
  readonly status: number | null;
  readonly retriable: boolean;
  readonly detail: string | null;

  constructor(
    kind: GenerationErrorKind,
    options: { status?: number | null; retriable: boolean; detail?: string | null },
  ) {
    super(`generation ${kind}`);
    this.name = "GenerationError";
    this.kind = kind;
    this.status = options.status ?? null;
    this.retriable = options.retriable;
    this.detail = options.detail ?? null;
  }
}

/** FastAPI reports validation errors as a string or a list of objects. */
function readDetail(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const detail = (body as { detail?: unknown }).detail;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    const parts = detail
      .map((item) =>
        item && typeof item === "object" && typeof (item as { msg?: unknown }).msg === "string"
          ? (item as { msg: string }).msg
          : null,
      )
      .filter((msg): msg is string => Boolean(msg));
    return parts.length > 0 ? parts.join("; ") : null;
  }
  return null;
}

async function readBody(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function errorFor(status: number, body: unknown): GenerationError {
  const detail = readDetail(body);
  if (status === 504) {
    // Shape set by the GenerationTimeoutError handler in app/main.py.
    const retriable =
      body && typeof body === "object" && "retriable" in body
        ? Boolean((body as { retriable?: unknown }).retriable)
        : true;
    return new GenerationError("timeout", { status, retriable, detail });
  }
  if (status === 422) {
    return new GenerationError("validation", { status, retriable: false, detail });
  }
  if (status === 401 || status === 403) {
    return new GenerationError("forbidden", { status, retriable: false, detail });
  }
  // 5xx other than the budget timeout is worth one retry, a 4xx is not.
  return new GenerationError("server", { status, retriable: status >= 500, detail });
}

export async function generateCurriculum(
  req: GenerationRequest,
  idToken: string,
  signal?: AbortSignal,
): Promise<CurriculumPackage> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), CLIENT_TIMEOUT_MS);
  // Abort if the caller's own signal fires, for example on unmount.
  const forward = () => controller.abort();
  signal?.addEventListener("abort", forward);

  let response: Response;
  try {
    response = await fetch(backendUrl("/api/generation"), {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
      body: JSON.stringify(req),
      signal: controller.signal,
    });
  } catch (err) {
    // A caller driven abort is not a failure to report, let it through.
    if (signal?.aborted) throw err;
    throw new GenerationError("network", {
      retriable: true,
      detail: err instanceof Error ? err.message : null,
    });
  } finally {
    window.clearTimeout(timer);
    signal?.removeEventListener("abort", forward);
  }

  if (!response.ok) throw errorFor(response.status, await readBody(response));
  return (await response.json()) as CurriculumPackage;
}

/**
 * Subjects and grades the Goals form may offer (D8).
 *
 * Fetched rather than hardcoded because servable subjects are the
 * intersection of the standards snapshots and the critic strategy map, and
 * the usable grades differ per subject. Either one hardcoded here would
 * drift the moment a snapshot changes, and the form would then offer a
 * combination the route rejects or, worse, a grade whose standards slice
 * is empty.
 */
export async function fetchSubjectCatalog(idToken: string): Promise<SubjectCatalog> {
  let response: Response;
  try {
    response = await fetch(backendUrl("/api/generation/subjects"), {
      headers: { Authorization: `Bearer ${idToken}` },
    });
  } catch (err) {
    throw new GenerationError("network", {
      retriable: true,
      detail: err instanceof Error ? err.message : null,
    });
  }
  if (!response.ok) throw errorFor(response.status, await readBody(response));
  return (await response.json()) as SubjectCatalog;
}
