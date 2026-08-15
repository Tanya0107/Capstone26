/**
 * Review Dashboard (book Fig 7) — FR5, FR6, FR7.
 *  - Edit / delete / append lessons & exercises (rich editor).
 *  - CriticMetricsPanel: critic report + quality scores for HITL validation.
 *  - Save edits -> POST /backend/api/feedback/edits (FR6 memory-bank update).
 *  - Publish -> PublishModal: pick students -> create assignment (FR7).
 */
export default function ReviewDashboardPage({ params }: { params: { moduleId: string } }) {
  return <main className="p-8">TODO Phase 4, Step 4.3 — module: {params.moduleId}</main>;
}
