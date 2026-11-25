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

Q14 (found in Step 4.4, blocks nothing in Phase 4, affects FR8 and the
pilot) - Answer text has no server side home. The book Fig 4 schema has no
collection for what a student writes, and BUILD_GUIDE Step 4.4 asks for
localStorage buffering, so the workspace keeps the draft on the student's own
device and a submission is recorded as the progress advance alone (D21).
Three consequences worth a decision rather than a silence. A teacher can see
that a student submitted an exercise but not what they wrote, so there is no
grading and no reading of student work anywhere in the product. The Phase 5
CAR and behavioural figures are unaffected, since they are computed from
telemetry, progress and the pre and post tests, but anything the pilot wants
to say about answer quality would have no data behind it. And a student who
moves to another device loses their drafts, which is acceptable for a
classroom pilot and would not be for a real deployment. Resolving this means
either accepting it for Phase B and saying so in the book, or adding a
studentAnswers collection with its own rules, which is a change to the frozen
Phase 2 contract and needs to be asked for, not assumed.

Q15 (found while reviewing open items after Step 4.4, blocks nothing in
code, affects FR2 and Phase 5 Step 5.5) - Standards corpus validation. All
three snapshots under backend/app/agents/standards/il_moe carry
draft_pending_validation true at version 0.2.0-draft: math with 11 entries,
science with 9, history with 8. BUILD_GUIDE Step 3.3 names this as a pre-task
and says outright that the agent drafts the entries and the team validates
them against the source documents before merge. The drafting happened, the
validation did not. So the question is who checks those 28 entries against
the MOE curriculum documents, which editions, and by when. The work is
smaller than it sounds, because every entry already carries its Hebrew
standard text and a citation to a document and a chapter, so this is
verification rather than authorship.

Four consequences. First, the Intake Agent may only reference IDs that exist
in the grade slice it is given, so every unit's standards mapping inherits
whatever the snapshot says, and a mis-stated standard or an invented chapter
citation propagates into every unit generated for that grade and domain.
Nothing downstream catches it: the Critic verifies answers and claims, not
curriculum text. Second, Step 5.5 asks 3 subject-competent teachers per
subject to rate Standards Alignment. A rater who knows the curriculum will
mark a unit down for a standard the corpus stated wrongly, which scores the
snapshot instead of the generator and confounds that rubric dimension across
the whole panel. Validating the files first is far cheaper than explaining
the confound in the book afterwards. Third, this is not the same flag as
D17's reference_validated, which covers the gold reference units and belongs
to Q8. Both corpora are drafts today and both say so: a teacher picking a
draft subject on the Goals screen sees the notice carried by
SubjectOption.draftCorpus, so nothing is hidden and nothing in Phase 4 is
blocked. Fourth, a GenerationRequest whose subject has no corpus file is
rejected with 422 before the pipeline runs, so a pilot that wants a fourth
subject needs curation before it needs code.

Resolving this means either validating the three files and clearing the flag,
or deciding to run the pilot and Step 5.5 on a declared draft corpus and
saying so in the book, next to the alignment numbers rather than in a
footnote.

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

