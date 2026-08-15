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
