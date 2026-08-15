/**
 * Staged loading indicator (NFR8): during curriculum generation, surface the
 * live pipeline stage ("Designing lessons…", "Critic verifying math…") instead
 * of a bare spinner — perceived-latency mitigation (book §Challenges #2).
 */
export default function LoadingIndicator({ stage }: { stage?: string }) {
  return <div role="status">TODO Phase 4: staged progress UI — {stage ?? "working"}</div>;
}
