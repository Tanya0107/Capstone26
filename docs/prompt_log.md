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

## Step 3.6 evidence, generation route and inline scoring (2026-11-19)

Full stack run, teacher token from the Auth emulator through
POST /api/generation on a live uvicorn to the Firestore emulator.
Harness: `backend/scripts/dev_latency_runs.py`. Record:
`evaluation/results/dev_runs/generation_latency.json`. DEV numbers, not
evaluation results (R1).

**Gate status: NOT MET.** Step 3.6 asks for p50/p95 over 10 runs and one
is recorded. The percentiles below are a single observation, not a
distribution. The harness accumulates runs across sessions and recomputes
`acceptance_gate` in the results file on every write, so the status
corrects itself when the campaign is finished rather than needing this
note kept in sync. Everything else in the Step 3.6 acceptance item, the
full stack path and the persistence verification, is met.

| Measure | Run 1, math_fractions_g5 |
|---|---|
| wall time, client side | 462.07s |
| server reported latency | 459.71s |
| NFR2b budget | 900s, within it |
| response validates as CurriculumPackage | yes |
| lessons / exercises | 3 / 6 |
| inline ROUGE-L | 0.1919 vs unit_01_math_fractions_g5 |
| reference validated | no, the unit is still DRAFT |
| critic approved | no, 1 issue at the 2 cycle cap |
| persistence checks | all passed |

The persistence check is the part worth keeping. It reads the emulator
back and asserts the D11 split holds in practice: 6 exercise docs, 6
matching exerciseSolutions docs each with a correctAnswer, and no
`correctAnswer` or `socraticHints` key on any student readable exercise
doc. R6 calls a leak there a release blocker, so it is verified at the
persistence layer and not only in the tutor.

### Why rouge_score is not on the request path

`rouge_score.rouge_scorer` imports nltk and numpy at module level, and
nltk pulls scipy in behind it. None of that is used here: the Porter
stemmer it wants is irrelevant because a custom tokenizer is passed
instead. Measured on this machine, importing it took **571s** cold and
the dependency chain stalled the first scoring test run past 300s without
finishing. That import has no place inside a request.

ROUGE-L is reimplemented directly instead, an LCS length over two token
lists per Lin 2004. `test_matches_the_rouge_score_library` pins it against
the library on 10 pairs including Hebrew, empty sides and a no overlap
pair, so the inline diagnostic and the Phase 5 offline harness cannot
drift. The scoring suite went from not finishing in 300s to **27 tests in
0.15s**, and the parity test is the only one that pays the import.

### The Hebrew tokenizer is not optional

`rouge_score`'s default tokenizer replaces every non Latin character with
a space, so Hebrew tokenizes to the empty list and every score would have
been a silent 0.0, with no error to notice. That is now the first
assertion in the scoring tests. Known limitation, recorded rather than
hidden: Hebrew prefix letters stay attached to their word, so בשברים and
שברים are separate tokens and matches are undercounted. The inline number
is a conservative lower bound. Stemming is a Phase 5 question for
compute_nlp_metrics.py, which owns the reported metric.

### Observed, not acted on: a wrong_answer flag whose detail denies itself

The run came back unapproved on one issue, exercise 5, whose stated answer
is a categorical label plus a number, `מתכון ראשון; 9/8`. The critic's own
detail text reads "Both answers are mathematically equivalent with
different notations for the first part of the answer", while the issue
type it emitted is `wrong_answer`. Both D14 guards passed it through,
which means the deterministic comparison did not positively agree.

Probing `answers_equivalent` with that stated answer against seven
plausible phrasings of the same claim, exactly one returns False:

    False   'מתכון 1; 9/8'        numeric [{1.0}, {1.125}]
    True    'מתכון ראשון; 9/8'    numeric [{1.125}]
    True    'המתכון הראשון; 9/8'  numeric [{1.125}]
    True    'הראשון; 1.125'       numeric [{1.125}]
    True    'מתכון א; 9/8'        numeric [{1.125}]

So there is a real and specific defect: when one side writes an ordinal
label as a digit and the other as a word, the digit becomes a phantom
numeric value, and the rule that every independent value must appear in
the stated answer then fails on a label rather than on arithmetic.

Not fixed here, deliberately. Whether that is what produced this
particular flag is unproven, because the critic's independent answer is
not recorded anywhere, so the diagnosis above is a demonstrated mechanism
and not a confirmed cause. Fixing it by discarding independent values the
stated answer lacks would weaken the guard against genuine multi value
errors, and an earlier dev run had a legitimate two value answer
(`10; 32`), which is exactly the trade D14 refused to make. The harness
now records `critic_issues` on every run so the next occurrence does not
need a 460s rerun to inspect, and recording the critic's independent
answer alongside a wrong_answer belongs with the Step 5.4 critic
quantification D14 already points to.

Nothing was lost to the teacher in the meantime: the package was returned
with `approved: false` and the issue surfaced, which is the designed FR3
behaviour at the regeneration cap, not a dropped draft.

## Step 4.1 evidence, design tokens and app shell (2026-11-19)

Phase 4 opens with a design pass, so the choices are recorded here and in
D18 rather than left implicit in class names.

Direction: warm academic. One token set lives in CSS variables in
`frontend/src/styles/globals.css`, and `tailwind.config.ts` maps every
color utility onto those variables through `rgb(var(--token) /
<alpha-value>)`. The teacher theme is the default deep teal. `AppShell`
sets `data-role="student"`, which re-points the same variables at warm
amber and sand. The consequence worth stating: no screen names a color,
so a screen written for one audience renders correctly for the other.
Density, not hue, carries the rest of the split, `max-w-shell` with a
tight rhythm for teachers against `max-w-reading` with an open one for
students.

Typefaces are Heebo for display and Assistant for body, both drawn as
Hebrew families rather than Latin ones extended to Hebrew (D5). They load
through `next/font`, which self hosts them at build time, so there is no
third party request and no swap driven layout shift. Both are confirmed
present in the installed `next` font data with the `hebrew` subset and the
weights requested.

### The staged loader shows estimates, and says so

`LoadingIndicator` lists the six orchestrator stages and advances through
them while a generation is in flight. The honest limit:
`POST /api/generation` is a single request that returns the finished
package, so the browser has no progress channel and cannot know the real
server stage.

The per stage durations are therefore estimates, but they are measured
estimates, taken from the single pass stage timings already recorded in
`evaluation/results/dev_runs/summary.json`:

| Stage | math_fractions_g5 | math_hard_percent_g6 | Used |
|---|---|---|---|
| intake | 28.42s | 27.55s | 28s |
| scope_sequence | 18.36s | 21.74s | 20s |
| lesson_design | 84.99s | 102.83s | 94s |
| assessment_design | 42.06s | 48.26s | 45s |
| critic | 10.31s | 14.22s | 12s |
| package | 7.70s | 7.00s | 7s |

The UI shows no percentage and no countdown, because either would claim a
precision the client does not have. It shows the stage list, which stage
is active, and the real elapsed clock. When the estimated schedule runs
out before the response arrives, the indicator stops advancing and says
the critic asked for a revision, which is what is actually happening: the
orchestrator has routed back to lesson design for up to two regeneration
cycles (FR3). That is why the two measured runs above finished at 311.86s
and 533.40s against a 206s single pass estimate. Replacing estimates with
real stage events would mean streaming generation progress the way D15
streams tutor turns, and that is not in Phase 4 scope.

### RTL and comment style audits

R10 asks for logical properties rather than physical ones. A grep for
`pl-`, `pr-`, `ml-`, `mr-`, `rounded-l`, `rounded-r`, `border-l`,
`border-r`, `text-left` and `text-right` across every `.tsx` in
`frontend/src` returns nothing, so the whole frontend is currently clean,
not only the files this step wrote.

D7 forbids em dashes, arrows, ellipses and semicolons in comments. The
skeleton imported in Step 0.1 carries nine such docstrings. The one in
`LoadingIndicator.tsx` was rewritten with the file in this step. The other
eight sit in component files that Steps 4.2 to 4.6 rewrite, so they are
left for those steps rather than touched here to keep this commit to its
own scope.

### Two defects the build surfaced

First, a duplicated landmark. `AppShell` owns the `main` element, and six
stub pages inside the role shells still opened their own `<main
className="p-8">`, so every authenticated page rendered two `main`
landmarks nested inside each other. That is invalid HTML and hands
assistive technology two document bodies. The shell introduced the
conflict, so it was fixed here rather than deferred to the steps that own
those pages, by replacing the inner element with a plain `div` and letting
the shell supply the gutter. The pages themselves still say TODO and still
belong to Steps 4.2 to 4.6.

Second, the `next build` route table under-reports the shells. It credits
`/teacher/dashboard` and `/student/dashboard` with 87.5 kB of First Load
JS against 190 kB for `/login`, which would suggest the authenticated
shells ship a third less JavaScript than the login screen. They do not.
`.next/app-build-manifest.json` shows the Firebase chunks
(`bc9e92e6`, `69806262`, `290`) attached to `/teacher/layout` rather than
to the page, because `ProtectedRoute` and `NavBar` are imported by the
layout. The browser loads layout chunks and page chunks together, so the
real first load for a shell is close to the login figure. The number to
cite for NFR1 is the Lighthouse measurement and the manifest, not that
column.

### Measuring the acceptance criteria, and a false alarm worth recording

Two of the three Step 4.1 criteria are claims about computed style under
real conditions, so they are measured in a browser rather than asserted
from the stylesheet. Two harnesses do it, both in `frontend/scripts/`, both
run against a production build with the emulators and seeded users up.
Their tooling is installed with `npm i --no-save lighthouse puppeteer-core`
so that CI, which runs `npm ci`, is unaffected.

`lighthouse_shells.mjs` exists because a plain `lighthouse` command cannot
measure these pages. Both shells sit behind `ProtectedRoute`, so an
unauthenticated audit is redirected to `/login` and would quietly report a
shell URL while scoring the login screen. The script signs in with
puppeteer first and hands Lighthouse the same browser. Two consequences
are recorded in the output rather than hidden. Lighthouse clears storage
before a run by default, which would sign the browser out mid audit, so
the shell runs set `disableStorageReset` and therefore describe a
returning visitor, not a cold first visit. The `/login` run keeps the
default and is the cold reference. The first version of this script also
recorded the URL it requested rather than the one Lighthouse landed on,
which is exactly the failure it was written to prevent, so it now records
`finalDisplayedUrl`, probes the live DOM for the nav, the landmark count
and the active role theme, and fails the gate when a run did not measure
the shell.

`a11y_shell_probe.mjs` drives real Tab presses, because `:focus-visible`
only engages for keyboard focus and a scripted `element.focus()` would
prove nothing about what a keyboard user sees. It also injects a span
carrying `animate-breathe` and reads its computed animation under both
motion preferences, since the breathing dot lives in `LoadingIndicator`
and no screen mounts that until Step 4.2.

The false alarm. For several iterations this probe reported that the
teacher shell had no working tab order at all: every Tab press left
`document.activeElement` on the body, while the student shell walked
correctly. The DOM was not the cause. A diff of the two rendered documents
showed only the expected differences, role attribute, nav label, density
classes, two extra links and the TODO text, with no `inert`, no stray
`tabindex` and no `aria-hidden`. All five teacher elements were visible,
correctly positioned and focusable programmatically, and there were no
console errors and no DOM mutations in the header. Reversing the probe
order showed the failure followed the role rather than the position, which
made it look real. Four isolated variants then passed on both roles,
plain, after `bringToFront`, after seeding focus on the body, and after an
explicit `focus()`, each walking the teacher order correctly as skip link,
three nav links, sign out.

The cause was the probe itself. It ran focus diagnostics before the walk,
calling `focus()` on the body and on the first link to check whether focus
was being stolen, and that manipulation left the sequential focus
navigation starting point in a state where Tab reported no movement. The
walk now runs first, on a page whose focus nothing has touched, and every
other measurement runs after it. A prefetch hypothesis was tested along
the way, since the teacher nav has three prefetchable links and the
student nav has only its current route, and it was rejected: disabling
prefetch changed nothing, and the change was reverted rather than left in
as a cargo cult fix.

Two guards were kept from the investigation. The walk now fails if it
reports the same element twice, because counting a stuck tab order as
several stops would turn it into a pass, and it must reach the sign out
button. An earlier run did report eight stops that were all the same skip
link while every assertion passed, which is the same class of defect as
the Lighthouse URL gap above: a measurement that looks like evidence and
is not.

### Step 4.1 acceptance result

Gate status: MET, with the content caveat stated below.

| Target | Performance | Accessibility | Best practices | FCP | LCP | TBT | CLS |
|---|---|---|---|---|---|---|---|
| `/login`, cold | 100 | 100 | 100 | 0.2s | 0.6s | 0ms | 0 |
| teacher shell | 100 | 100 | 100 | 0.4s | 0.6s | 0ms | 0 |
| student shell | 100 | 100 | 100 | 0.4s | 0.6s | 0ms | 0 |

Lighthouse 12.8.2, desktop form factor, local production build. Evidence in
`evaluation/results/dev_runs/lighthouse_shells.json`. Each shell run carries
the proof that it measured the shell and not a redirect: matching
`finalDisplayedUrl`, the nav present, exactly one `main` landmark, the Hebrew
skip link, and the role theme reading `teacher` or `student` respectively.
A CLS of 0 is the self hosted font claim holding up, since a swapped webfont
is the usual source of shift on a page like this.

The honest reading of three perfect scores: this is a shell with stub pages
inside it. The result says the chrome, the token layer and the font loading
cost nothing measurable, which is worth knowing before Phase 4 builds on
them, but it is not evidence about NFR1 on a populated screen. Steps 4.2 to
4.6 add real content, Firestore listeners and SSE streaming, and the
measurement is worth repeating then. That is why the results file carries
`content_caveat` rather than leaving a reader to infer it.

Keyboard focus and reduced motion, from
`evaluation/results/dev_runs/a11y_shell_probe.json`:

| Role | Tab order | Ring on every stop | Reduced motion |
|---|---|---|---|
| teacher | skip link, 3 nav links, sign out | 3px solid | 1.8s to 0.00001s, iteration count 1 |
| student | skip link, 1 nav link, sign out | 3px solid | 1.8s to 0.00001s, iteration count 1 |

The skip link is the first stop for both roles and its settled box is inside
the viewport, so it is genuinely reachable rather than merely present. Both
orders of the probe give the same result.
