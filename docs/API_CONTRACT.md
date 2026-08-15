# API Contract (Phase 2 artifact — keep in sync with schemas.py / models.ts)

Base URL (dev): http://localhost:8000 — proxied by Next.js at /backend/*.
Auth: `Authorization: Bearer <Firebase ID token>` on every route (NFR4).

| Method | Path | Role | Request | Response | FR/NFR |
|---|---|---|---|---|---|
| POST | /api/generation | teacher | GenerationRequest | CurriculumPackage | FR1–FR4, NFR2 |
| POST | /api/tutor/turn | student | TutorTurnRequest | TutorTurnResponse | FR11, FR12 |
| POST | /api/tutor/turn/stream | student | TutorTurnRequest | SSE token stream | NFR8 |
| POST | /api/feedback/edits | teacher | TeacherEditRecord | {semantic_distance, stored} | FR6 |
| GET | /api/analytics/assignment/{key} | teacher | — | aggregated metrics JSON | FR8, FR13 |
| GET | /healthz | — | — | {status} | NFR6 |

Errors: 401 no/invalid token · 403 wrong role · 422 schema violation ·
504 generation budget exceeded (frontend must degrade gracefully — NFR7).

Full machine-readable spec: FastAPI auto-generates /docs (Swagger) and
/openapi.json — export a frozen copy here at the end of Phase 2.
