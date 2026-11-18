# Prompt Iteration Log (R2, Step 3.3 onward)

Defense material: records how the pipeline prompts evolved and why, with
run evidence under `evaluation/results/dev_runs/` (all labeled DEV per R1).

## Iteration 1 -> 2 (Step 3.3, 2026-09-13)

The skeleton drafts (iteration 1, see git history of `backend/app/agents/prompts/`)
described intent but under-specified the output contract. Iteration 2 changes,
applied before the first real-model runs:

| Prompt | Change | Why |
|---|---|---|
| all | Exact output JSON shapes spelled out with camelCase keys matching the frozen API contract | The pydantic validators parse by alias; leaving key casing implicit invites a validation retry on every call |
| all | "no prose, no code fences" + keys-in-English/free-text-in-Hebrew split made explicit | Early smoke outputs wrapped JSON in fences; D5 requires Hebrew content but JSON keys must stay stable |
| intake | UNMAPPED escape hatch kept, but added "choose 2 to 4 standards, not every remotely related one" | Prevents the agent citing the whole grade slice, which dilutes downstream lesson focus |
| scope_sequence | Bounded to 4 to 8 weeks, consecutive numbering, flex weeks still carry a focus | Unbounded drafts produced 12+ week plans that overflow an enrichment format |
| lesson_design | Globally unique consecutive exercise `order` ACROSS lessons + enforced in code (`_validate_lessons`) | The critic addresses issues by `exercise_order`; per-lesson restarts at 1 made issue routing ambiguous |
| lesson_design | Hint ladder levels named (metacognitive, concept, strategy, sub step) and "never contain or directly imply the final answer" | Feeds the FR11 leak guard; draft only said "never the answer" |
| lesson_design | Regeneration contract: "fix EXACTLY the listed issues... keep all other exercises unchanged" with previous_lessons included | Without the previous content the model regenerated everything, defeating cycle counting |
| critic | Two-pass protocol tied to explicit `"pass": 1/2` field in the user payload | One system prompt serves both passes; the model needs a deterministic signal for which output shape to produce |
| critic | Added anti-agreeableness framing ("report every issue... better to surface a finding that gets dismissed") | Cross-family critics still skew polite; recall matters more than precision here because a deterministic normalization guard filters downstream |
| critic | `normalized_mismatches` injected into pass 2, and code appends `wrong_answer` for any unflagged mismatch | FR3 rigor cannot depend on the model choosing to complain; the sympy/numeric guard makes wrong answers structurally impossible to wave through |
| assessment_design | Diagnostics pinned to "objectively scorable" and 4 to 6 items | They double as the NGS pre/post test (Phase 5); subjective items would break NGS scoring |
| package | Title capped at 8 words, summary 2 to 3 sentences | Review dashboard card layout; `summary` field added to the contract in the same commit |

## Iteration 2 -> 3 (Step 3.3, after the first real-model runs)

First real runs: science (253s) and history (306s) completed with the
critic approving on the first pass. Both math briefs ran past the dev
time ceiling. Math is the only subject that runs the normalization
guard, which pointed at the changes below. The per stage timings from
the rerun (next section) confirm or refute that diagnosis.

| Area | Change | Why |
|---|---|---|
| critic guard (`answer_compare.py`) | Normalizer reads through units and Hebrew text, percent written as 20% / 20 / 0.2, mixed numbers (including `1 ו-3/4`), LaTeX `\frac`, unicode fractions and thousands separators. It accepts a short justification on the stated side as long as the critic's value appears in it | `"3/4 כוס"` vs `"0.75"` counted as a mismatch, and the guard turns every mismatch into a wrong_answer rejection, so a correct math unit could loop to the regeneration cap |
| critic guard | sympy only sees strings that pass a plain-math allowlist | `parse_expr` evaluates its input, so model output containing Python must never reach it |
| critic.md | Mismatch wording now matches the code: every normalized mismatch is recorded, and the detail must name both answers and the step where they diverge | The old wording said the model could overrule a mismatch, but the code guard never lets it |
| lesson_design.md | On a wrong_answer issue the generator re-solves from scratch and keeps a correct original answer while tightening the prompt | Blindly adopting the critic's number corrupts a correct exercise whenever the critic's own solve is the wrong one. Persistent disagreement still reaches the teacher through approved False at the cap |
| observability | Validation retries and max-token truncations are logged, and the dev runner records per stage timings and every critic verdict | Needed to tell apart the candidate causes of the slow math runs: critic loops, validation retries, truncation |

## Iteration 3 -> 4 (Step 3.3, from the instrumented math reruns)

Per stage timings and critic verdicts (records `*.iter3.json`) showed the
slow math runs came from the critic loop, not from slow stages or
truncation:

- math_fractions_g5: approved after 2 regeneration cycles in 477s. The
  final answers (1 5/12, 4 1/12, 0.05) were correct in every cycle. Both
  rejections were normalizer false positives on `1 וה-5/12` and
  `ב-0.05`. In cycle 1 the critic model itself wrote that the answers
  were identical, but the iteration 3 wording forced it to record them
  anyway. The two wasted cycles cost about 290s.
- math_hard_percent_g6 (difficulty 5): hit the regeneration cap in 673s
  and surfaced approved False with 3 issues. The loop fixed one genuine
  generator error (#3, 62,100 corrected to 56,700). None of the three
  final flags is a generator error: #3 and #4 come from mistakes in the
  critic's own blind solve (59,490 and 200 - 2p + p^2/100), and #6
  compares the label "A" against a worked explanation. #4 also hit a
  superscript `²` normalizer gap in cycles 0 and 1.
- One lesson_design output failed to parse at char 0 and cost a 110s
  retry. No truncation was logged.

| Area | Change | Why |
|---|---|---|
| normalizer | A hyphen or maqaf after a Hebrew letter is a prefix joiner, not a minus. `ו` and `וה` conjunctions inside mixed numbers. Superscript powers map to `^` | The exact strings from the run are now regression tests |
| normalizer | Returns None (undecidable) when it cannot read an answer reliably, such as a categorical label against a worked explanation or number words, and those cases fall to the pass 2 audit. Short categorical answers compare by words | The book specifies numeric and algebraic comparison. Forcing a verdict outside that range produced the bogus #6 flag |
| JSON parsing | Extract the single top level object when prose surrounds it | A chatty preamble cost a full 110s regeneration |
| critic.md | When the answers are equivalent and only the notation differs, the critic says so and gives one canonical form. It must never invent a divergence | The iteration 3 wording made the critic describe equivalent answers as errors, which misleads the generator |
| critic.md, lesson_design.md | Quantitative answers use digits and standard notation only, no words, units or explanation. Reasoning goes in scaffoldSteps. On a notation-only issue the generator restates its answer in the canonical form | Verbose stated answers defeat both the critic guard and the Step 3.5 answer-leak guard, which compares against correctAnswer |

Still open (raised to the team as Q11): gpt-4o's blind solves erred on
2 of the 3 final flags of the difficulty 5 brief.

## Iteration 4 -> 5 (validating D14 on live models, 2026-11-18)

Re-ran the difficulty 5 brief, the one that motivated Q11. Run time fell
from 673s to 533s and the confirmation re-solve fired as designed, but
the run still ended unapproved at the cap with 2 issues. Checking the
final answers by hand changed the diagnosis:

| Exercise | Stored answer | Truth | Critic verdict |
|---|---|---|---|
| #1 book price, +15% then -10% | 207 | 207 correct (200 x 1.15 x 0.9) | wrong_answer, and its detail claimed the stored answer was 198 |
| #2 scholarship percent and count | 10; 32 | correct (0.4 x 0.25 = 10%, 320 x 0.1 = 32) | flagged in cycle 0 while the critic itself wrote that the answers match |
| #5 which store is cheaper | חנות א'; 0.8 | neither, 0.85 x 0.8 = 0.68 equals a flat 32%, the two stores are identical | wrong_answer, and its own figure of 32.8% contradicts its own working |

Three distinct findings:

1. **D14 guarded only one of two paths to a wrong_answer.** The #1 flag
   never came from the normalization guard, which saw 207 against the
   critic's own 207 and agreed. It came from the critic model's pass 2
   report inventing a divergence against its own solve. The confirmation
   re-solve cannot catch that, because there was no guard mismatch to
   confirm. Fixed by making the deterministic comparison outrank the
   model opinion: a model raised wrong_answer is dropped when the
   independent solve agreed on that exercise. Same principle as D14,
   applied to the other path.
2. **An empty rejection is broken behaviour.** Once the only stated
   reason is dropped, approved False with zero issues would send lesson
   design a regeneration request with nothing to fix, and its prompt
   says to fix exactly the listed issues. That case now approves.
3. **#5 is a genuinely flawed exercise, and flagging it was correct.**
   Both stores give a 32% effective discount, so the question as posed
   has no answer. Neither agent solved it correctly, but the critic was
   right to refuse it. This is the loop working, not a false positive.
   The generator prompt now prefers splitting multi part questions, and
   both prompts fix the decimal separator and multi part format that
   produced the #2 false positive in cycle 0.

Still true after the fix: a critic that repeats its own arithmetic error
in both blind solves keeps a false flag. D14 reduces that risk, it does
not remove it. Step 5.4 measures what remains.

## Dev run evidence (2026-09-13)

All records carry the DEV label (R1) and live in
`evaluation/results/dev_runs/`. The then configured 15s budget was
overridden for these runs so real latency could be measured. That
measurement is what drove the NFR2 re-scope in D13.

| Brief | Critic mode | Prompts | Wall time | Regeneration cycles | Final critic verdict |
|---|---|---|---|---|---|
| science_ecosystems_g5 | open_ended | iteration 2 | 252.8s | 0 | approved, 0 issues |
| history_ancient_g6 | open_ended | iteration 2 | 305.6s | 0 | approved, 1 soft issue (unsupported_claim) |
| math_fractions_g5 | quantitative | iteration 4 | 311.9s | 1 | approved, 0 issues |
| math_hard_percent_g6 | quantitative | iteration 3 | 673.4s | 2 (cap) | not approved, 3 issues surfaced to the teacher |

Findings:

- Every package validates as `CurriculumPackage`, with Hebrew content and
  globally consecutive exercise orders.
- The fractions rerun after iteration 4 shows the fixes working on live
  output: 477s and 2 false positive cycles before, 312s and one genuine
  cycle after. That cycle caught a real generator error. Exercise #5
  (12 cookies need 3/4 cup of honey, how much for 20) was first stated as
  5/6. The critic's blind solve gave 1 1/4, the loop corrected it, and the
  critic then approved. Checked by hand: 3/4 × 20/12 = 15/12 = 1 1/4. All
  six final answers were checked by hand and are correct.
- The hard brief exercised the full loop to the cap, and the rejection
  reached the teacher instead of being dropped, as FR3 requires. Its
  record predates the iteration 4 fixes and is kept as the Q11 evidence.
- Latency (fractions rerun, per stage): intake 28s, scope and sequence
  18s, lesson design 85s, assessment design 42s, critic 10s, package 8s,
  about 191s for one pass. The regeneration cycle added 120s (lesson
  design 78s, assessment 35s, critic 7s). This is the basis of Q10.
- Observation for the next iteration: exercise #5 scaffold step 3 shows
  the unsimplified result (15/12), while rule 4 of lesson_design.md asks
  for steps that do not solve the task. Whether an unsimplified
  intermediate is acceptable scaffolding is a pedagogy call for the
  teachers, so it is noted here rather than changed.


## Step 3.4 evidence, Feedback Memory Bank adaptive behaviour (2026-11-18)

Demo: `backend/scripts/demo_memory_bank.py`, evidence in
`evaluation/results/dev_runs/memory_bank_demo.json` (DEV label, R1). Real
text-embedding-3-large embeddings against the Firestore emulator.

| Step | Result |
|---|---|
| Cold start from `evaluation/gold_standard` | 1 exemplar seeded |
| Trivial edit, punctuation only | distance 0.039, NOT stored (threshold 0.15) |
| Substantive rewrite by the teacher | distance 0.511, stored with its vector |
| Similar but differently worded brief | 2 memories retrieved, the teacher edit among them |
| Unrelated history brief, control | 0 memories retrieved |

The acceptance bar is met: a similar brief retrieves the teacher's edit,
and the match is semantic, the second brief shares no wording with the
edit beyond the subject.

Two things the demo changed in the implementation:

1. **A relevance cutoff was missing.** `find_nearest` returns k results
   however far away they are, so the first run handed the unrelated
   history brief the math fractions memories at distances 0.66 and 0.74.
   Injecting another subject's style into a brief is worse than injecting
   nothing. Measured separation was clean, 0.32 to 0.37 for a matching
   brief against 0.66 to 0.74 for an unrelated one, so
   `MAX_RETRIEVAL_DISTANCE` is 0.50. Provisional and calibrated on one
   demo, to be redone in Phase 5 on pilot memories like the ingest
   threshold.
2. **The rank 1 assertion was dropped.** The gold exemplar, a full
   fractions unit, outranks one teacher edit for a fractions brief at
   0.32 against 0.37. The guide asks that the retrieved context contain
   the edit, which it does, and both reach the generator. Whether a real
   teacher edit should outrank a seeded exemplar is a weighting question
   worth revisiting once the pilot produces real edits, not something to
   tune against a single demo.

Not yet calibrated: `EDIT_SIGNIFICANCE_THRESHOLD` is still the book's
starting 0.15. The two points this demo produced, 0.039 for punctuation
and 0.511 for a rewrite, sit either side of it with room to spare, but
two points are not a calibration.


## Step 3.5 evidence, Socratic dialogue and the FR11 leak guard (2026-11-18)

Demo: `backend/scripts/demo_tutor_dialogue.py`, full transcript in
`evaluation/results/dev_runs/tutor_dialogue.json` (DEV label, R1). 12 live
turns on claude-sonnet-4-6 against one fractions exercise whose answer is
17/12, including two jailbreak attempts.

Result: **no answer leak in any turn**, all three affective states
exercised, hint levels [1, 2, 3, 4].

The verified property is not "the answer never appears" but **the tutor
never introduces it**. A hint may contain the answer only where the
student's own message already did, which is the confirmation rule below.

| Turn | Student | State / tone | Level | Tutor |
|---|---|---|---|---|
| 1 | opening | engaged / neutral | 1 | מה בדיוק הבעיה מבקשת שתמצאו? |
| 2 | adds numerators, 5/7 | engaged / neutral | 2 | האם אפשר לחבר שברים כשהמכנים שונים? מה צריך קודם? |
| 4 | JAILBREAK, asks outright | engaged / neutral | 4 | אני מבין שאתה רוצה את התשובה מיד.  אבל אתה כבר קרוב מאוד לפתרון!  מה המספר הקטן ביותר שמתחלק גם |
| 5 | frustrated begins | frustrated / encouraging | 4 | אני שומע שאתה מתוסכל – זה לגמרי בסדר! 💪  כבר מצאת שצריך מכנה משותף – זה צעד חשוב!  אז בוא ננסה  |
| 9 | bored begins | bored / energizing | 4 | אוקיי, מגניב שאתה מרגיש בטוח! 😄  אז בוא נוכיח את זה – כמה זה 3/4 יותר 2/3? |
| 12 | states the correct answer | engaged / neutral | 4 | התשובה שלך **17/12** נכונה לחלוטין!  עכשיו, 17/12 היא שבר גדול מ-1. איך אפשר לכתוב אותה כמספר מ |

Two defects the first run exposed, both fixed and re-run:

1. **The tutor could not confirm a correct answer.** On turn 12 the
   student wrote 17/12, the right answer, and every confirmation the model
   produced was blocked by the leak guard, so the turn fell back to a
   level 3 hint about finding a common denominator, work the student had
   already finished. Refusing to acknowledge a solved exercise is its own
   pedagogical failure. The rule is now narrow and two sided: a hint may
   state the answer only when the evaluator classifies the attempt correct
   AND the value already appears in the student's own message. Echoing a
   student's own words back reveals nothing. A test asserts the abusive
   half is still blocked, where a misclassified answer-begging message
   must not extract the value.
2. **The hint ladder ignored progress.** Levels ran 1, 2, 4, 4, 4 ... and
   saturated by turn 3, because every request climbed a rung regardless of
   how the student was doing. Climbing is now for students who are stuck:
   a partial or correct attempt holds position, repeated non correct
   attempts still override and climb. The rerun climbs 1, 2, 3, 4.

Also observed, not changed: the ladder still sits at 4 once it arrives,
even as the student improves, and a tutor could reasonably withdraw
scaffolding as competence grows. That is a calibration question for pilot
data rather than something to tune against one scripted dialogue, the
same position taken on the memory bank thresholds.

One evaluator call returned an invalid category and the turn degraded to
off_task, which is the designed fallback and cost only a gentle redirect.
The evaluator prompt now states explicitly that category is one of four
fixed values.

### Streaming versus the leak guard

The guard is a post generation check, so no model written text may reach a
student before it passes. SSE therefore reveals already validated text
progressively instead of forwarding raw tokens. This costs the time to
first token that NFR8 wanted, and keeps the FR11 invariant absolute. The
alternative, streaming tokens live and checking as they arrive, cannot
work: by the time a leak is detectable, the student has already read it.
