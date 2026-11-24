/**
 * Where browser calls to the FastAPI backend go.
 *
 * Measured: the Next rewrite in next.config.mjs answers 500 at exactly
 * 30.00s for any upstream slower than 30s. A generation legitimately runs
 * 4 to 11 minutes, so through the proxy the FR1 happy path can never
 * arrive, and neither can the NFR7 504, because the proxy's own 500
 * replaces it long before the server's budget expires.
 *
 * NEXT_PUBLIC_BACKEND_ORIGIN therefore sends these calls to the backend
 * directly. CORS already allows the frontend origin
 * (settings.frontend_origin). Note that a cross origin call shows up twice
 * in a network trace, once as the CORS preflight OPTIONS, so anything
 * asserting on status codes must match on the method too.
 *
 * With the variable unset the calls fall back to the proxy path, which
 * keeps a single origin and is fine for anything comfortably under 30s.
 */
const BACKEND_ORIGIN = process.env.NEXT_PUBLIC_BACKEND_ORIGIN ?? "";

export function backendUrl(path: string): string {
  return BACKEND_ORIGIN ? `${BACKEND_ORIGIN}${path}` : `/backend${path}`;
}
