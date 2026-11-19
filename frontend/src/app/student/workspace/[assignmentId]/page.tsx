/**
 * Student workspace (book Fig 9 area) — FR10 + FR11.
 * Layout: exercise pane (prompt, scaffold steps, answer input) + SocraticBot
 * sidebar. Telemetry session runs for the visible exercise (Phase 4, Step 4.5).
 * NFR7: answers buffered to localStorage until server ack.
 */
export default function WorkspacePage({ params }: { params: { assignmentId: string } }) {
  return <div>TODO Phase 4, Steps 4.4-4.6 — assignment: {params.assignmentId}</div>;
}
