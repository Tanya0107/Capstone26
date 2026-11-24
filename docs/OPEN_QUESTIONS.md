# Open Questions

Resolved questions moved to docs/DECISIONS.md (Q1 to Q4 are now D1 to D6,
Q10 to Q12 are now D12 to D14, Q6 and Q7 are now D15 and D16).

Q5 (blocks pilot) - Account provisioning. How are the pilot teacher and the
10 or more student accounts created? Seed script proposal in Phase 2, Step 2.5
is the dev default.

Q8 (blocks Phase 5, Step 5.3) - Gold standard authorship. Who writes and
validates the 5 reference units in Hebrew, and in what timeframe? Critical
path for the BERTScore, ROUGE and BLEU targets.

Q9 (Phase 5) - Deployment target. Local demo only, or deployed (for example
Vercel plus Cloud Run)? Affects the NFR6 uptime measurement methodology.

Q10, Q11 and Q12 are resolved, see docs/DECISIONS.md D13, D14 and D12.
D13 (the NFR2 re-scope) was accepted on 2026-11-19. It still changes a
requirement set in the approved Phase A book, so the deviation and its
rationale belong in the Phase B book and the defense slides, stated
outright. No open question remains.

Q13 is RESOLVED, see docs/DECISIONS.md D20. The user approved adding the
screen on 2026-11-22 and it is built, with a live listener so an orphaned
draft surfaces by itself. Original question kept for the record.

Q13 (found in Step 4.3, blocks nothing yet but affects FR5) - No step builds
the teacher dashboard. `/teacher/dashboard` is a Step 4.1 stub and Steps 4.4
to 4.6 cover the student surface, telemetry and the bot, so the screen a
teacher lands on after login is never implemented. Two consequences. First,
a teacher has no way to find a module they created: the Review Dashboard is
reachable only by moduleKey, which only the Goals screen knows, and only for
the run that just finished. Second, it makes the orphan module from Step 4.2
unrecoverable: when a generation succeeds on the server but the client has
already given up, the draft is persisted and nobody can ever reach it. A
drafts list on the teacher dashboard fixes both at once and is the obvious
home for it. Asking rather than building it, because adding a screen the
guide does not list is a scope change, not a detail.

