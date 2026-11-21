# Requirements Traceability Matrix (skeleton to book)

Scope note (D8, D9): the book frames requirements around math but the official
scope is all subjects. Subject is a parameter everywhere. Metric targets are
verified via stratified subject sampling: math, science and history, one per
subject type, reported per subject and overall.

| Req | Description (short) | Where implemented |
|---|---|---|
| FR1 | Teacher goals input | frontend app/teacher/create + GoalsForm (controlled by the page so a 504 returns the filled form, NFR7) + GET /api/generation/subjects driving the subject and grade selects from the served corpus; GenerationRequest |
| FR2 | Auto curriculum generation | agents/orchestrator + agents/pipeline/* + agents/standards (MOE corpus, D4) |
| FR3 | Agentic self-correction | agents/pipeline/critic_agent + answer_compare (normalization guard) + orchestrator loop + config.SUBJECT_TYPES (D8) |
| FR4 | Automated quality scoring | app/evaluation/scoring (inline ROUGE-L with the Hebrew tokenizer, plus the post response BERTScore task that patches the module doc) + routes/generation + /evaluation (offline BLEU and reported metrics, Step 5.3) (D17) |
| FR5 | Review Dashboard | app/teacher/review/[moduleId] + ReviewEditor |
| FR6 | Semantic distance -> memory bank | core/memory_bank (ingest, retrieve, cold start seed) + routes/feedback + Firestore find_nearest with the vector index in firestore.indexes.json (D3) |
| FR7 | Publish to distribution list | PublishModal + assignments collection |
| FR8 | Telemetry aggregation + dashboards | routes/analytics + core/telemetry + AnalyticsDashboard |
| FR9 | Browse/select/launch programs | app/student/dashboard + listenToAssignments |
| FR10 | Workspace + scaffolding | workspace page + ExerciseCard + ScaffoldingSteps |
| FR11 | Socratic bot, no answers | agents/tutoring/socratic_agent + answer_leak guard + question_generator ladder + SocraticBot + adversarial leak tests + exerciseSolutions split (D11, firestore.rules + rules.test.ts) |
| FR12 | Affective state detection | tutoring/adaptive_strategy (documented heuristics over ATT/HSR/idle) + lib/firebase/telemetry |
| FR13 | Feedback + progress history | ProgressSummary + compute_ngs |
| NFR1 | UI < 2s | Next.js SSR/CSR split; design tokens and self hosted fonts in tailwind.config.ts plus styles/globals.css (no third party font request, no swap shift); Lighthouse proxy on the shells (Step 4.1), full check in Phase 5 |
| NFR2a | Tutor turn <= 15s | tutoring/socratic_agent deadline + settings.tutor_turn_timeout_seconds (D13) |
| NFR2b | Generation <= 900s | orchestrator budget + latency field + routes/generation 504 mapping + scripts/dev_latency_runs (DEV p50/p95 evidence) (D13) |
| NFR3 | 500ms sync | Firestore onSnapshot listeners everywhere |
| NFR4 | RBAC | firestore.rules + rules.test.ts + api/deps + ProtectedRoute |
| NFR5 | Telemetry anonymization | telemetryEvents keys-only design |
| NFR6 | 99.5% uptime | /healthz + load-test monitoring (Phase 5) |
| NFR7 | Graceful degradation | localStorage buffering + 504 handling |
| D5, R10 | Hebrew RTL UI | app/layout.tsx (lang he, dir rtl, Heebo and Assistant via next/font) + AppShell role themes + logical property audit (Step 4.1) |
| NFR8 | Loading indicators | LoadingIndicator staged over the six orchestrator stages, estimates taken from the measured DEV medians, with a regeneration hold state (D18) + SSE streaming |


## Use Case to FR to Implementation (Fig 1, revised model per D10)

| Actor | Use Case | FRs | Entry point |
|---|---|---|---|
| Teacher | Create Enrichment Program | FR1, FR2, FR3, FR4 | app/teacher/create, POST /api/generation |
| Teacher | Review Content (extend: Modify Content) | FR5, FR6 | app/teacher/review/[moduleId], POST /api/feedback/edits |
| Teacher | Publish Program to Distribution List | FR7 | PublishModal, assignments collection |
| Teacher | Monitor Student Analytics | FR8 | app/teacher/analytics, GET /api/analytics |
| Teacher | View Performance Evaluation | FR8, FR13 | app/teacher/analytics |
| Student | Browse and Select Enrichment Program | FR9 | app/student/dashboard |
| Student | Solve Enrichment Problems (include: Browse and Select) | FR10, FR13 | app/student/workspace/[assignmentId] |
| Student | Interact with Teachable Agent (extend of Solve) | FR11, FR12 | SocraticBot, POST /api/tutor/turn |
| Student | View History | FR13 | ProgressSummary |

Internal automation intentionally absent from Fig 1 but present as FRs:
generation pipeline (FR2), agentic self correction (FR3), algorithmic scoring
(FR4), memory bank learning (FR6), scaffolding (FR10), affective state
detection (FR12).

Terminology note: Fig 1 says Teachable Agent. Architecture docs and code use
Socratic Tutoring Agent and Pedagogical Bot. Same component.
