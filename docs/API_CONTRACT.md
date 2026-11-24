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

## Phase 2 freeze summary (Step 2.5)

Frozen spec: `docs/openapi.phase2.json`, guarded by the schema snapshot test
in `tests/test_api/test_generation_endpoint.py`. Changes made while freezing:

- Wire format is camelCase end to end: every Pydantic model inherits
  `ApiModel` (alias generator `to_camel`), matching `models.ts` exactly.
  Requests are accepted in camelCase (snake_case also tolerated), responses
  are serialized camelCase.
- `POST /api/feedback/edits` now returns a typed `FeedbackIngestResponse`
  (`{semanticDistance, stored}`).
- `GET /api/analytics/assignment/{key}` now returns a typed
  `AssignmentAnalytics` (`{assignmentKey, students: StudentAnalyticsRow[]}`);
  aggregation itself lands in Phase 5, Step 5.2.
- `TutorTurnRequest.conversationHistory` is a typed `ChatMessage[]` and
  carries an optional `telemetrySnapshot` (FR12 input).
- Contract mirrors added on the TS side: `TelemetrySnapshot`,
  `TeacherEditRecord`, `FeedbackMemoryRecord`, `ExerciseSolution`,
  `ChatMessage`, analytics models; `assignedStudentKeys` on modules and
  exercises (D11).

### Post-freeze contract changes

- Step 3.3: `CurriculumPackage.summary` (optional string) added — the
  Package Agent's short Hebrew teacher-guide summary. Mirrored in
  `models.ts`, frozen spec re-exported.
- Step 3.4: no schema change. `POST /api/feedback/edits` gained its real
  implementation, so only the endpoint `description` text moved and the
  spec was re-exported. The route now also rejects an edit whose
  `teacherKey` is not the caller's uid with 403, matching the ownership
  rule the security rules apply to every other teacher-written collection.

- Step 3.6: `POST /api/generation` gained its real implementation and
  `QualityScores` gained two fields, `referenceUnit` and
  `referenceValidated` (D17). A similarity score without the reference it
  was measured against cannot be displayed honestly, and the only gold
  unit in the repo is still DRAFT, so the Review Dashboard must label such
  a score a diagnostic rather than a metric (R1). `bertscoreF1` is now
  documented as patched in after the response, and `bleu` as offline only.
  Mirrored in `models.ts`, frozen spec re-exported.
  New non-2xx responses on that route:
  - 403 when `teacherKey` is not the caller's uid, matching the ownership
    rule already applied to `POST /api/feedback/edits`. The module's
    `creatorTeacherKey` is always taken from the verified token, never
    from the body.
  - 422 when the subject has no curated standards corpus or no entry in
    the critic strategy map (D8). Both corpora are checked before any
    model call, because the standards loader raises at stage 1 and the
    critic strategy map at stage 5, which would waste minutes of
    generation on a request that cannot succeed.

## Answer-protection design (R6, decided in Step 2.1, logged as D11)

The book's Fig 4 stores `correctAnswer` and `socraticHints` on the exercise
doc. That shape cannot be secured client-side: any student allowed to read an
exercise would receive the answer fields too, because Firestore rules cannot
hide individual fields of a readable doc. Each generated exercise is therefore
persisted as two docs sharing one id:

| Collection | Fields | Readable by |
|---|---|---|
| `exercises/{id}` | prompt, order, scaffoldSteps, moduleKey, assignedStudentKeys | teachers; assigned students |
| `exerciseSolutions/{id}` | correctAnswer, socraticHints, exerciseKey, moduleKey | teachers only |

The Socratic tutor reads `exerciseSolutions` server-side via the Admin SDK
(which bypasses rules), so hints and answer checking work without the student
client ever being able to fetch protected fields. The pipeline-level
`Exercise` model still carries `correct_answer` because the generator
produces it and the teacher Review Dashboard displays it; the split happens
in `core/firestore.save_curriculum_package`.

## Student read gating via denormalized audience arrays

The book left student read scope as a TODO ("students may read only modules
referenced by their assignments"). A `get()`-based rule (look up the
assignment, check membership) works for single-doc reads but rejects all list
queries: Firestore evaluates list rules against the query shape, so a rule
must be provable from the query's own filters. The chosen design denormalizes
the audience onto the content docs at publish time:

- `curriculumModules.assignedStudentKeys` and `exercises.assignedStudentKeys`
  are written in the same batch that creates the assignment (FR7).
- Rules allow student reads only when `request.auth.uid` is in that array;
  student queries must therefore include an `array-contains` filter on it
  (composite index added in `firestore.indexes.json`).
- Unpublished drafts have an empty array, so students can never read them.

Trade-off: publish fans out one array write per exercise doc (batched, ~10-20
docs per module at capstone scale) in exchange for rules-enforceable
client-side reads that keep the NFR3 onSnapshot listeners.
