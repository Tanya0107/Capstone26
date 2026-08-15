# BUILD GUIDE — Enrichment Platform (Phase B)

**Project:** A Tool for Building Enrichment Programs (Braude College, code 26-2-D-7). All-subjects scope (D8); evaluation via stratified subject sampling (D9).
**Authors:** Naama Burmil, Tanya Noritsin · **Advisor:** Moran Kupfer
**Audience of this document:** an AI coding agent (Claude Opus 4.8 / Fable 5 class) executing the implementation, step by step, inside this repository skeleton.
**Source of truth for requirements:** the Phase A Project Book. Every FRn/NFRn reference below points to it.

---

## 0. Operating Rules for the AI Agent

Read this section before every work session. These rules override convenience.

**R1 — Targets are not results.** The metrics BERTScore F1 ≥ 0.80, ROUGE-L ≥ 0.55, BLEU ≥ 0.40, CAR ≥ 70%, IRR (Fleiss' κ) ≥ 0.75, NGS ≥ 0.30, generation latency ≤ 15s (p95), uptime ≥ 99.5% are **Phase B success-criteria TARGETS**. Never write code comments, UI copy, README text, commit messages, or reports that present them as achieved. A metric becomes a result only when a file in `evaluation/results/` proves it, with methodology recorded.

**R2 — One step at a time, gated by acceptance criteria.** Each step below ends with **Acceptance** — a checklist. Do not begin the next step until every item passes. If an item cannot pass, stop and report why.

**R3 — Stop-and-ask protocol.** When you hit a `STOP-AND-ASK` marker (or any genuinely underdetermined decision), do not guess. Output a question block in this exact format and wait:

```
❓ QUESTION [Qn or NEW]
Context: <which step, which file>
What I need to know: <one precise question>
Options I see: <A / B / C with one-line tradeoffs>
My default if you say "you decide": <option + why>
```

Open questions Q5–Q9 live in `docs/OPEN_QUESTIONS.md`; resolved decisions live in `docs/DECISIONS.md` (D1–D7). Question answers gate specific steps (noted inline).

**R4 — Tests before features where possible.** Every module in this skeleton has a matching test file with the required cases documented in its docstring. Implement the test (un-skip it) either before or together with the feature. `pytest` must be green (excluding explicitly-skipped future steps) at the end of every step.

**R5 — The contract is sacred.** `backend/app/core/schemas.py` and `frontend/src/types/models.ts` are two views of one contract. Any change to one must be mirrored in the other **in the same commit**, and `docs/API_CONTRACT.md` updated.

**R6 — Never leak answers to students.** `correctAnswer` and `socraticHints` must never be readable by the student client (Firestore rules + backend serving path + the leak-guard test in `tests/test_api/test_tutor_endpoint.py`). Treat any violation as a release blocker.

**R7 — No real LLM calls in unit tests.** Use `FakeChatModel` (`tests/conftest.py`). Real-model runs belong to Phase 5 evaluation scripts only, and their cost must be reported.

**R8 — Commit discipline.** Small commits, imperative messages, reference the step: `feat(pipeline): implement CriticAgent independent solve (Step 3.3)`. Push to a feature branch per phase; open a PR per phase for the human team to review.

**R9 — Traceability.** When you implement or change anything, update `docs/TRACEABILITY.md` if the FR/NFR → file mapping changed.

**R10 — Language.** Code, comments, and internal docs in English. All generated content, UI copy, and prompts' output are Hebrew (D5). The app shell is `lang="he" dir="rtl"`; use Tailwind logical properties (ps/pe/ms/me/start/end), never left/right utilities. Keep UI strings in a `strings.ts` per surface, not inline in components.

**R11 — Comment style (team convention, D7).** Comments are clean and concise. No em dashes, no emojis, no arrow symbols, no semicolons inside comments. Python `->` return annotations are syntax, not comments, and are exempt. New and edited files must comply; legacy skeleton comments are cleaned opportunistically when a file is touched.

---

## Phase 0 — Prerequisites & Verification (½ day)

### Step 0.1 — Toolchain
**Actions**
1. Verify: Node ≥ 20, Python ≥ 3.11, `firebase-tools` CLI (`npm i -g firebase-tools`), Java ≥ 17 (required by the Firestore emulator), git.
2. `cd frontend && npm install` — must complete cleanly.
3. `cd backend && python -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt`.
   *Note:* `bert-score` pulls torch; if the environment is CPU-only/slow, install it lazily in Phase 5 instead — comment it out now and record that in the commit.
4. `firebase emulators:start` from `firebase/` — Auth on :9099, Firestore on :8080, UI on :4000.

**Acceptance**
- [ ] `npm run typecheck` passes in `frontend/` (skeleton compiles).
- [ ] `pytest` runs in `backend/` — the two telemetry tests fail with `NotImplementedError` (expected; everything else is skipped).
- [ ] Emulator UI reachable at http://localhost:4000.

### Step 0.2 — Secrets & config
**Actions**
1. Copy `backend/.env.example → backend/.env`, `frontend/.env.local.example → frontend/.env.local`.
2. Q1 and Q4 are resolved (see `docs/DECISIONS.md` D1, D2, D5). Set the API keys for both Anthropic and OpenAI in `backend/.env`; the model defaults are already correct.

**Acceptance**
- [ ] `.env` files exist locally and are git-ignored (verify with `git status`).

---

## Phase 1 — Environment & Core Architecture (book: Dev Process Phase 1) (1–2 days)

### Step 1.1 — Repo hygiene
**Actions**
1. Initialize git (if not already), create branch `phase-1-foundation`.
2. Add a GitHub Actions workflow `.github/workflows/ci.yml`: two jobs — backend (`pip install`, `pytest`), frontend (`npm ci`, `npm run typecheck`, `npm run lint`). Cache dependencies. CI must run on every PR.
3. Add `LICENSE` (ask the team; default: no license / all rights reserved for a capstone).

**Acceptance**
- [ ] CI green on the PR.

### Step 1.2 — Runnable shells
**Actions**
1. Backend: `uvicorn app.main:app --reload` starts; `GET /healthz` → `{"status":"ok"}`. The four routers import cleanly (stubs raise only when called).
2. Frontend: `npm run dev` renders the placeholder root page; `/backend/healthz` proxies to FastAPI (verify the rewrite works).
3. Wire the frontend Firebase client to the emulators (`NEXT_PUBLIC_USE_EMULATORS=true`) and confirm no console errors on load.

**Acceptance**
- [ ] Both dev servers run concurrently; proxy verified with a browser request.
- [ ] Emulator connection confirmed (Firestore panel shows a connection when you perform a trivial read).

---

## Phase 2 — Database Schema & API Contract (book: Dev Process Phase 2) (3–5 days)

### Step 2.1 — Freeze the Firestore schema
**Actions**
1. Review `frontend/src/types/models.ts` + `backend/app/core/schemas.py` against the book's Fig 4. Fix any drift you find; these files are already written to Fig 4 but **you must verify field-by-field**.
2. Decide and document (in `docs/API_CONTRACT.md`) the answer-protection design required by R6. Recommended: split each exercise into
   - `exercises/{id}` — student-safe fields (prompt, order, scaffoldSteps), and
   - `exerciseSolutions/{id}` — `correctAnswer`, `socraticHints`, readable by teachers only, served to the tutor server-side.
   Update rules, both schema files, and Fig-4 notes accordingly. *(This is a deliberate improvement over the book's flat exercise doc — record it as a design decision for the defense.)*
3. Update `firebase/firestore.rules` to match, including tightening the `curriculumModules` student-read TODO (students may read only modules referenced by their assignments — enforce via backend reads if rules become too complex; document the choice).

**Acceptance**
- [ ] Rules deploy to the emulator without errors (`firebase deploy --only firestore:rules` against emulator / `emulators:start` loads them).
- [ ] A written design note in `docs/API_CONTRACT.md` explains the answer-protection split.

### Step 2.2 — Rules tests
**Actions**
1. Add `firebase/rules.test.ts` using `@firebase/rules-unit-testing` (add a minimal `firebase/package.json` for it). Cases, minimum:
   - student cannot read `exerciseSolutions` / `feedbackMemoryBank`;
   - student can read only assignments containing their uid in `assignedTo`;
   - student can create `telemetryEvents` only with `studentKey == auth.uid`; cannot update/delete any;
   - teacher can create/update own `curriculumModules`, not another teacher's;
   - unauthenticated → everything denied.

**Acceptance**
- [ ] All rules tests pass against the emulator; wired into CI (emulator in CI via `firebase emulators:exec`).

### Step 2.3 — Backend repositories
**Actions**
1. Implement `core/firestore.py` repository functions: `save_curriculum_package` (module doc + decoupled exercise docs + solutions docs, batched write, returns `moduleKey`), `append_telemetry_event`, `save_feedback_memory`, `fetch_similar_memories` (metadata query now; the `find_nearest` vector query lands in Step 3.4 per D3).
2. Add `tests/test_firestore_repo.py` running against the emulator: round-trip a sample `CurriculumPackage`, assert decoupling (exercises are separate docs linked by `moduleKey`).

**Acceptance**
- [ ] Round-trip test green against the emulator.

### Step 2.4 — Auth end-to-end (NFR4)
**Actions**
1. Backend: implement `api/deps.verify_token` with `firebase_admin.auth.verify_id_token`; read role from **custom claims** (preferred) with a users-doc fallback. Implement `require_teacher` / `require_student` (already sketched).
2. Frontend: implement `useAuth` (onAuthStateChanged → role → idToken with refresh), `ProtectedRoute`, the login page (email/password), and role-based redirect on `/`.
3. Write the provisioning seed script `backend/scripts/seed_users.py`: creates 1 school, 2 teachers, 12 students in Auth + `users` docs + custom claims. `STOP-AND-ASK Q5` for real-pilot provisioning; the seed script is the dev default.

**Acceptance**
- [ ] Manual flow: seed → login as teacher → land on `/teacher/dashboard`; login as student → `/student/dashboard`; cross-role URL access redirects away.
- [ ] `test_generation_endpoint.py` case 3 (non-teacher → 403) un-skipped and green (with mocked pipeline).

### Step 2.5 — Freeze the API contract
**Actions**
1. Fill every route's request/response models (already typed) and make FastAPI serve accurate `/openapi.json`.
2. Export the frozen spec: `curl :8000/openapi.json > docs/openapi.phase2.json`; summarize any changes in `docs/API_CONTRACT.md`.
3. Un-skip and implement contract tests 2 and 5 in `test_generation_endpoint.py` (422 on bad input; JSON schema snapshot).

**Acceptance**
- [ ] Contract tests green; `docs/openapi.phase2.json` committed. **Phase 2 PR opened.**

---

## Phase 3 — Multi-Agent Backend & Learning Loop (book: Dev Process Phase 3) (2–3 weeks; the core)

### Step 3.1 — LLM abstraction *(decided: D1/D2)*
**Actions**
1. Implement `core/llm.get_chat_model(role)` for both providers (Anthropic generator/tutor, OpenAI critic): async, JSON mode support, retry w/ exponential backoff (max 2), and a `timeout_s` parameter the orchestrator sets from the **remaining** NFR2 budget.
2. Implement `core/llm.embed` (batching, L2-normalized).
3. Unit tests with `FakeChatModel` verifying the retry/timeout wrapper logic (wrap the fake, not the network).

**Acceptance**
- [ ] A manual smoke script (`backend/scripts/smoke_llm.py`) gets one real completion + one real embedding; cost printed. Not part of CI.

### Step 3.2 — Orchestrator as a LangGraph state machine
**Actions**
1. Define the shared state `TypedDict` (request, rag_context, standards, sequence, lessons, assessment, critic_report, package, started_at, cycles).
2. Build the graph exactly as sketched in `agents/orchestrator.py`: linear chain → critic → conditional edge (approved → package; rejected & cycles < MAX → lesson_design with issues; rejected & cycles == MAX → package with `approved=False` surfaced to the teacher, never silently dropped).
3. Enforce NFR2: wrap `graph.ainvoke` in `asyncio.wait_for(settings.generation_timeout_seconds)`; on timeout raise a typed error the route converts to 504 with a machine-readable body (`{"error":"generation_timeout","retriable":true}`) for NFR7 handling.
4. Populate `generation_latency_seconds` on every successful package.

**Acceptance**
- [ ] Graph unit test with all-fake agents: happy path, 2-rejection loop (cycles counter correct), loop cap, timeout → typed error. (`test_critic_agent.py` cases 4–5 un-skipped.)

### Step 3.3 — The six pipeline agents *(standards corpus decided: D4)*

> Pre-task for Intake: curate `agents/standards/il_moe/{subject}.json` files from official Israeli MOE curriculum documents, following `agents/standards/README.md`. Curate the three D9 evaluation subjects first (math, science, history); further subjects are added on demand. This is human-verified content work; the agent drafts entries, the team validates them against the source documents before merge.
Implement in order; each agent = prompt iteration + `run()` + schema validation + fake-model unit test.

**Actions per agent** (pattern):
1. Flesh out its prompt in `agents/prompts/*.md` (the drafts are starting points — iterate against 3 real briefs and record before/after outputs in `docs/prompt_log.md`; this log is defense material).
2. `run()`: render prompt with state, call model in JSON mode, `model_validate` the output, merge into state. On validation failure retry once with the validation error appended to the prompt; then raise.
3. Unit test with canned fake output (valid + invalid JSON cases).

**Critic specifics (FR3 — the differentiator, be rigorous):**
- Subject-aware dual strategy per D8, as documented in `critic_agent.py`: quantitative subjects get the two-pass independent-solve protocol (Pass 1 sees prompts only, no generator answers; Pass 2 compares + audits); open-ended subjects get claim extraction + independent fact verification (`factual_error` / `unsupported_claim` flags). Use `settings.critic_model` (gpt-4o per D1), a **different family** than the generator, so verification is genuinely independent. Maintain a `SUBJECT_TYPE` map (quantitative / open_ended) in config — a new subject must be classified before it can run.
- Answer comparison must normalize (numeric tolerance, fraction/decimal equivalence, algebraic form via `sympy` if needed — add to requirements if used).
- Un-skip `test_critic_agent.py` cases 1–3.

**Acceptance**
- [ ] End-to-end pipeline run with real models over 3 briefs produces schema-valid `CurriculumPackage`s; latencies recorded; at least one intentionally hard brief exercised the critic loop. Outputs saved under `evaluation/results/dev_runs/` (clearly labeled DEV, per R1).

### Step 3.4 — Feedback Memory Bank / Adaptive Learning (FR6) *(vector store decided: D3, Firestore find_nearest)*
**Actions**
1. Implement `core/memory_bank.ingest_teacher_edit`: embed original + edit, `semantic_distance = 1 − cosine`, store when above `EDIT_SIGNIFICANCE_THRESHOLD` (start 0.15; add a calibration note).
2. Implement `retrieve_context`: embed the request, fetch top-k memories via Firestore `find_nearest` with COSINE distance (add the required single-field vector index to `firestore.indexes.json`), format as few-shot "teacher previously changed X → Y, prefer Y-style" strings, cap tokens.
3. Wire into the route (`routes/feedback.py`) and the orchestrator intake state.
4. Cold start (book Challenge #3): loader that seeds the bank from `evaluation/gold_standard/` exemplars at first boot.
5. Un-skip `test_memory_bank.py` (fake embeddings — deterministic vectors).

**Acceptance**
- [ ] Demonstrated adaptive behavior: run a brief → simulate a substantive teacher edit → rerun a similar brief → show the retrieved context contains the edit memory (log evidence committed to `docs/prompt_log.md`).

### Step 3.5 — Socratic tutoring loop (FR11, FR12) *(Q6, Q7)*
**Actions**
1. Implement `response_evaluator.check` (LLM classify: correct / partial / misconception / off-task), `student_model.update`, `question_generator.next_hint` (hint-ladder policy: prefer pre-authored `socraticHints`; escalate level on repeated failure or `frustrated`; de-escalate/challenge on `bored`).
2. Implement `adaptive_strategy.assess` as **pure heuristic rules** over `TelemetrySnapshot` (documented thresholds; un-skip `test_adaptive_strategy.py`).
3. Implement `socratic_agent.run_turn` per its docstring, including the **post-generation answer-leak guard**: exact + normalized-numeric + high-similarity match against `correctAnswer`; on hit, regenerate at a more abstract level (max 2 tries, then return the safest metacognitive prompt).
4. Implement both route variants; SSE streaming for `/turn/stream`.
5. Un-skip `test_tutor_endpoint.py` — the adversarial leak test is mandatory (include ≥ 5 jailbreak-style student messages).

**Acceptance**
- [ ] Leak test green. Manual dialogue transcript (10+ turns, one frustrated scenario, one bored scenario) saved to `docs/prompt_log.md` showing tone/level adaptation.

### Step 3.6 — Assemble the generation route + inline scoring (FR4)
**Actions**
1. Implement `routes/generation.py` per its docstring TODO (RAG context → pipeline → persist → respond).
2. Implement `app/evaluation/scoring.score_package`: inline ROUGE-L against nearest gold reference (fast); schedule BERTScore async post-response (background task) and patch the module doc — keeping NFR2 intact.
3. Un-skip remaining `test_generation_endpoint.py` cases (happy path, 504/NFR7).

**Acceptance**
- [ ] Full stack demo: teacher token → POST generation → module + exercises + solutions in emulator → response validates. p50/p95 latency over 10 runs recorded (DEV numbers, labeled per R1). **Phase 3 PR opened.**

---

## Phase 4 — Frontend Workspace & Socratic Chatbot (book: Dev Process Phase 4) (2 weeks)

> Before any UI work: run a short design pass (palette, type pairing, layout tokens into `tailwind.config.ts` + `globals.css`). Two audiences — teachers (dense, dashboard-like) and students (spacious, encouraging, age-appropriate). Language is decided: Hebrew, RTL (D5). Audit every layout for RTL correctness and test with real Hebrew content, not lorem ipsum.

### Step 4.1 — Design tokens & app shell
Nav shells for both roles, token system, `LoadingIndicator` with staged pipeline messages (NFR8).
**Acceptance:** Lighthouse performance ≥ 90 on the shells (NFR1 proxy); keyboard focus visible; reduced motion respected.

### Step 4.2 — Teacher: Goals screen (FR1, Fig 6)
`GoalsForm` (validation mirrors `GenerationRequest`), submit → staged loading → route to review. NFR7: on 504, keep form state + retriable error UI.
**Acceptance:** happy path + timeout path demoed against the real backend.

### Step 4.3 — Teacher: Review Dashboard (FR5–FR7, Fig 7)
`ReviewEditor` (accordion per lesson; edit/append/delete; original-text tracking for diffing), `CriticMetricsPanel` (verdict, issues, cycles, scores — copy per R1), save → `POST /api/feedback/edits`, `PublishModal` → create assignment (FR7).
**Acceptance:** edit → save → memory-bank record visible in emulator; publish → assignment doc with `assignedTo`; e2e demo recorded.

### Step 4.4 — Student: dashboard & workspace (FR9, FR10, FR13, Figs 8–9)
`listenToAssignments` + `upsertProgress` (onSnapshot everywhere — NFR3), `ExerciseCard`, `ScaffoldingSteps` (progressive disclosure), `ProgressSummary`, localStorage answer buffering (NFR7).
**Acceptance:** two-browser demo — teacher publishes, student sees it live without refresh; simulated offline answer survives reload.

### Step 4.5 — Telemetry capture
Implement `lib/firebase/telemetry.ts` + `useTelemetry` exactly per the file's design block (heartbeats, idle exclusion, HSR clicks, batched writes, offline buffer, keys-only payloads — NFR5).
**Acceptance:** scripted 3-minute session produces plausible `telemetryEvents` in the emulator; an idle stretch visibly excluded from ATT accrual.

### Step 4.6 — Socratic bot UI (FR11)
`SocraticBot` sidebar with SSE streaming (`tutorTurnStream`), typing indicator (NFR8), every send → `recordHelpRequest`.
**Acceptance:** streamed tokens render progressively; HSR increments verified; no answer text ever displayed for a solved fixture (leak guard re-verified through the UI). **Phase 4 PR opened.**

---

## Phase 5 — Evaluation Framework & Integration Testing (book: Dev Process Phase 5) (2–3 weeks, overlaps pilot logistics)

### Step 5.1 — Test hardening
Un-skip everything remaining; add an end-to-end pytest (emulator + mocked LLMs) covering teacher-input → student-completion. CI fully green.

### Step 5.2 — Analytics (FR8, FR13)
Implement `core/telemetry.compute_att/tcv/hsr` (formulas per docstrings; un-skip math tests), `routes/analytics.py`, `AnalyticsDashboard` charts.
**Acceptance:** dashboard renders correct aggregates from a synthetic telemetry fixture with hand-computed expected values.

### Step 5.3 — NLP metric harness *(blocked by Q8 — gold standard)*
Stratified sampling per D9: gold references span the three sampled subjects (2 math, 2 science, 1 history minimum); report per-subject and overall. Similarity scores are always reported next to the critic stress-test accuracy for the same subject type — similarity ≠ correctness. Gold units authored & validated → `generate_candidates.py` → `compute_nlp_metrics.py` (per its docstring: like-vs-like comparison, Hebrew-valid scorers per D6: BERTScore on xlm-roberta-large, Hebrew-preserving ROUGE tokenizer, sacrebleu intl tokenization, all recorded in metadata) → `evaluation/results/nlp_metrics.json` with pass/fail vs `thresholds.yaml`.
**Acceptance:** results file exists with methodology metadata. **Only now may any document say whether targets were met (R1).** If below target: iterate prompts (Step 3.3 loop), re-run, keep all runs.

### Step 5.4 — Critic stress test (FR3 evidence)
`critic_stress_test.py` per docstring; report precision/recall/F1 per flaw type.
**Acceptance:** `results/critic_stress.json`; headline numbers added to defense materials *with* the planted-flaw methodology stated.

### Step 5.5 — Human evaluation: IRR & CAR
Prepare the expert rubric packet — raters must be competent in the subject they score (D9): per sampled subject, 3 subject-competent teachers rate that subject's packages (rubric: Standards Alignment / Readability / Pedagogical Soundness); compute IRR per subject panel, never pooled across subjects; `compute_irr.py` (Fleiss' κ). Define the CAR content-unit granularity **before** review sessions; `compute_car.py` from review diffs.
**Acceptance:** `results/irr.json`, `results/car.json` + rubric packet archived.

### Step 5.6 — Pilot / UAT
≥ 10 students: pre-test (from Assessment Design diagnostics) → platform sessions (telemetry live) → post-test → `compute_behavioral_metrics.py` (NGS, ATT, TCV, HSR). Teachers complete SUS.
**Acceptance:** `results/behavioral.json`, SUS scores recorded; consent/anonymization checklist (NFR5) signed off by the advisor.

### Step 5.7 — Load & availability (NFR2, NFR6) *(Q9 for methodology)*
Locust/k6 script simulating school-hour load; capture generation p95 latency and `/healthz` uptime over the window.
**Acceptance:** `results/load_test.json`; NFR verdicts written with methodology.

### Step 5.8 — Final report assembly
`evaluation/report.py` merges all results vs thresholds into one table (met / not met / partially, with evidence links). This table — not memory, not intention — is what goes into the Phase B book and defense slides.

---

## Definition of Done (project level)
- [ ] All FR1–FR13 demonstrably working in an end-to-end demo script (write `docs/DEMO_SCRIPT.md`), with full flows in at least two subjects of different subject types (D8/D9).
- [ ] All NFRs measured with recorded methodology; verdicts in the report table.
- [ ] CI green; rules tests green; leak-guard test green.
- [ ] `docs/TRACEABILITY.md` current; `docs/prompt_log.md` tells the prompt-iteration story.
- [ ] Every metric statement anywhere in the repo complies with R1.

## Suggested timeline (13 weeks)
| Weeks | Phase |
|---|---|
| 1 | 0 + 1 |
| 2–3 | 2 |
| 4–7 | 3 |
| 8–9 | 4 |
| 10–12 | 5 (pilot logistics start week 8!) |
| 13 | buffer + report |

*Start gold-standard authorship (Q8) and pilot recruitment (Q5) in parallel with Phase 3 — they are the true critical path.*
