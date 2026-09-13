# Open Questions

Resolved questions moved to docs/DECISIONS.md (Q1 to Q4 are now D1 to D6).

Q5 (blocks pilot) - Account provisioning. How are the pilot teacher and the
10 or more student accounts created? Seed script proposal in Phase 2, Step 2.5
is the dev default.

Q6 (blocks Phase 3, Step 3.5) - Bot transport. Confirm the default: student to
FastAPI over SSE for the live turn, mirrored to Firestore for persistence.

Q7 (Phase 3, Step 3.5) - Session state. In process per session StudentModel is
enough for the pilot. Is Redis actually required by the committee?

Q8 (blocks Phase 5, Step 5.3) - Gold standard authorship. Who writes and
validates the 5 reference units in Hebrew, and in what timeframe? Critical
path for the BERTScore, ROUGE and BLEU targets.

Q9 (Phase 5) - Deployment target. Local demo only, or deployed (for example
Vercel plus Cloud Run)? Affects the NFR6 uptime measurement methodology.

Q10 (blocks Phase 3, Step 3.6) - NFR2 generation budget. DEV runs of the
full six stage pipeline take 253s to 673s per package
(evaluation/results/dev_runs/summary.json). A single pass with no critic
cycle takes about 190s to 210s, and each regeneration cycle adds 120s to
145s. Lesson design (80s to 110s per call) and assessment design (35s to
50s per call) dominate. With the configured 15s budget every real generation
request returns 504, so the Step 3.6 full stack demo cannot succeed as
configured. The 15s p95 stays a Phase B target (R1) and will be reported
with its measured value. Options: (A) keep the synchronous API and raise
GENERATION_TIMEOUT_SECONDS to a realistic ceiling such as 900s, reporting
NFR2 as not met, (B) make generation asynchronous, where POST returns at
once, the pipeline writes staged progress to Firestore and the frontend
listens (API contract change), (C) cut work: run assessment design once
after the critic loop instead of every cycle (deviates from the graph
sketched in orchestrator.py, saves 35s to 50s per cycle with no quality
cost since the critic never reads the assessment), a faster model for the
light stages (changes D1), or smaller units.

Q11 (Step 3.3 quality, measured in Phase 5, Step 5.4) - Critic blind solve
errors. On the difficulty 5 dev brief, 2 of the 3 final wrong_answer flags
came from mistakes in gpt-4o's own blind solve while the stated answers
were correct, so a correct unit reached the teacher marked unapproved.
Options: (A) keep as is, measure in the Step 5.4 stress test, the teacher
resolves flags, (B) on a guard mismatch run one more blind solve of only
those exercises and flag only when both blind solves disagree with the
stated answer (one extra critic call, only when mismatches exist, keeps
independence), (C) a stronger reasoning model for the critic (changes D1).

Q12 (default applied, please confirm) - Science subject type. D9 calls
science a mixed subject, but the critic SUBJECT_TYPES map is two valued.
Science is classified open_ended (claim verification) because the curated
elementary standards are conceptual. A calculation heavy science unit
would get claim checking instead of an independent solve.
