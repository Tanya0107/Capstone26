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

## Step 4.2 evidence, teacher Goals screen (2026-11-21)

### Why the form fetches its subjects instead of listing them

The Goals form must respect two facts that only the backend knows, so it
reads them from a new `GET /api/generation/subjects` rather than carrying
its own list.

Which subjects are servable is an intersection, not a list: a subject needs
both a curated standards snapshot on disk and an entry in the critic
strategy map (D8). `physics` is classified but ships no snapshot, so it is
not servable, and the POST route rejects it with 422 after the teacher has
filled the form in.

The second fact is the dangerous one. The snapshots do not cover the same
grades. Math and science cover 4 to 6 while history covers 6 to 8, and
`load_standards` returns an *empty slice* for a grade outside its snapshot
rather than raising. A teacher asking for history in grade 4 would
therefore get a full run, minutes long, in which the Intake Agent had no
standards to cite, and nothing anywhere would report an error. The grade
select is driven per subject by the catalog so that combination cannot be
submitted, and a test asserts every advertised grade yields a non empty
slice.

The endpoint is purely additive to the frozen Phase 2 contract: the
re-exported spec diff shows zero removed lines. `draftCorpus` is carried
through so the form says the snapshot is still awaiting team validation
instead of presenting a draft as settled (R1), which it currently does for
all three subjects.

### A real NFR7 defect, found by demoing the timeout path

The acceptance asks for the timeout path demoed against the real backend.
Running it returned **500, not 504**, and the UI showed the generic server
error rather than the timeout message with its retry.

A budget overrun has two exits and only one was mapped. `run_pipeline`
wraps the graph in `asyncio.wait_for` and converts its timeout into
`GenerationTimeoutError`, which `app/main.py` turns into the
`{"error": "generation_timeout", "retriable": true}` 504 the frontend
degrades on. But `agents/base.py` also gives every model call the
*remaining run budget* as its own timeout, so an overrun can instead
surface as `LLMTimeoutError` from inside a stage. That escaped
`run_pipeline` uncaught and became a bare 500 with no retriable flag.

This is not an artifact of the tiny budget used to force it. Because the
inner timeout is derived from the remaining budget, the model call and the
outer timer expire at the same instant, so which one raises first is a
race. NFR7's graceful degradation would have worked only on the coin flip
where the outer timer won, and the existing 504 test only ever exercised
that side. `run_pipeline` now maps `LLMTimeoutError` to
`GenerationTimeoutError`, and a second endpoint test pins the other exit,
asserting the same 504 body and that nothing was persisted and no scorer
scheduled for a run that produced no package.

### The demo harness passed on the wrong thing

Worth recording because it is the third time in Phase 4 that a measurement
looked like evidence and was not. The first version of
`dev_goals_screen_demo.mjs` judged the timeout path by whether a retriable
error appeared with the form state intact. Those were all true for the
500, so it reported `ok: true` while the contract it existed to check was
broken. It now requires the response to be a 504 and the visible error to
be the timeout message specifically, not merely some retriable error.

### Resolved: the keystroke drop was the harness, not the app

Found while trying to fill the Goals form through the UI. First recorded
here as an open application defect that would make FR1 unusable. That
conclusion was wrong, and the correction is kept in place rather than
deleted, because the way it was reached is the point.

Symptom as first recorded: on an authenticated page, an input accepts the
first one to three characters and then stops. `document.activeElement`
still reports the field, `document.hasFocus()` is true, the node is not
replaced, there are no DOM mutations and no console errors, but native
`keydown` stops firing on the element altogether.

Measured again against a production build, the symptom is sharper than
that. It is not a partial drop. **No trusted key event is delivered at
all**, zero `keydown` on a capture phase `window` listener, while on
`/login` in the same browser session the same probe records eight of
eight.

What it is not, each ruled out by measurement rather than reasoning:

| Suspected | Result |
|---|---|
| Lifting form state to the page (NFR7) | Not it. A sibling input with purely local state fails the same way |
| React controlled inputs | Not it. A vanilla non React input injected into the same page also fails |
| `AppShell`, the nav or the skip link | Not it. Removing the shell made it worse, not better |
| Next `<Link>` prefetch on the teacher nav | Not it. `prefetch={false}` changed nothing, and the change was reverted |
| A headless browser artifact | Partly it. Headful reproduces, but every reproduction went through CDP key dispatch, which is the actual variable |
| `puppeteer` mixing `insertText` with key events | Not it. Pure ASCII through key events alone fails too |
| An auth re render storm or a remount | Not it. Two `onIdTokenChanged` emissions and a single form mount during the failure, later confirmed by 0 blur events and 0 node swaps across 3s |

What it correlates with is being signed in. A vanilla input typed at 100ms
intervals is perfect on `/login`, and fails on `/teacher/dashboard` and on
`/student/dashboard`, neither of which contains a form at all. Those two
shells are Step 4.1 work, so this predates Step 4.2.

It also retroactively explains the Step 4.1 investigation recorded above,
where the teacher shell appeared to have no working tab order while the
student shell walked correctly. That was the same mechanism, key events not
reaching the document, and the conclusion there that the tab order itself
was sound still holds.

The suspect named here first was three `useAuth` subscriptions per shell
page. That was also wrong on its facts: `NavBar` does not call `useAuth`
at all, so `/teacher/dashboard` holds exactly one subscription, and it
fails. No fix was built on the guess.

What settled it was measuring the channels around the keyboard instead of
the keyboard, on `/teacher/create`, signed in, in one run:

| Channel | Result |
|---|---|
| Trusted key events (`page.type`, `page.keyboard.press`, raw CDP `Input.dispatchKeyEvent`) | Nothing delivered. 0 `keydown` |
| Trusted mouse events | Delivered. `mousedown` fires |
| CDP `Input.insertText` | Delivered. Text lands in the field |
| Focus stability, 30 samples over 3s | Textarea focused in 30 of 30, 0 `blur` events, 0 node swaps, same node throughout |
| Frames | One. No iframe, in the document or in puppeteer's view |
| Long tasks, console errors | None |

No application mechanism can produce that combination. Page code cannot
suppress a `keydown` that never arrives, and it is not a remount or stolen
focus, because the field holds focus for the whole window with no blur and
no node swap. A renderer that accepts mouse input and `insertText` is a
live renderer. The missing channel is CDP key delivery to that tab, which
belongs to the test rig.

The confirmation from the other direction: `scripts/dev_goals_screen_demo.mjs`
passes unchanged, today, against this build. It drives the form with native
value setters and real clicks and never dispatches a key on an
authenticated page, which is exactly the channel that works.

Withdrawn: the claim that a teacher would lose most of what they type and
that FR1 is unusable. There is no evidence for it. The honest residue is
that the exact rig mechanism is unnamed, and that nobody has yet typed on a
real keyboard on one of these pages. That check costs a person ten seconds
and is still worth doing, but it is not a release blocker and it does not
gate Phase 4.

Rule this leaves for every later UI harness, and the reason Step 4.3 and
Step 4.4 must not be written around `page.type`: text goes in through the
native value setter plus an `input` event, the way `setField` does it, and
clicks go in as real clicks. A harness that types on an authenticated page
measures the rig, not the product.

The Step 4.1 tab order investigation above was the same channel failing,
so its conclusion that the tab order itself is sound still holds. The one
check that would have caught this at the start, and that three rejected
hypotheses did not include, was asking whether anything else about the page
was unhealthy at the moment the keys vanished. Focus, mouse and the DOM
were all fine, and that was knowable on day one.

### The dev proxy cannot carry a generation, measured at 30s

The happy path failed its first attempt with a 500, and the backend log
showed no completed POST at all. The Next log named the cause:
`Failed to proxy http://localhost:8000/api/generation Error: socket hang up`.

The rewrite in `next.config.mjs` has a hard timeout. Measured with a
stand in server that answers after a requested delay, so it cost no model
calls:

| Upstream delay | Through the proxy |
|---|---|
| 10s | 200 after 10.01s |
| 35s | 500 after 30.01s |
| 65s | 500 after 30.00s |
| 125s | 500 after 30.00s |

Exactly 30.00s, every time. A generation runs 4 to 11 minutes, so through
that proxy the FR1 happy path could never arrive, and neither could the
NFR7 504: the proxy's own 500 replaces it long before the server's 900s
budget expires. The earlier timeout demo passed only because the forced 5s
budget let the backend answer inside the 30s window, which is a good
illustration of why a passing test on a shortened budget is not evidence
about the real one.

`lib/api/generation.ts` now sends both generation calls straight to the
backend origin through `NEXT_PUBLIC_BACKEND_ORIGIN`, falling back to the
proxy when it is unset. CORS already allowed the frontend origin. The 30s
limit is recorded as a comment in `next.config.mjs` so nobody routes long
calls back through it. Short calls still use the proxy and the single
origin it gives.

Consequence worth knowing: calling the backend cross origin makes the
browser send a CORS preflight, so each call now shows twice in a network
trace, once as `OPTIONS` and once as the real method. The backend log
confirms one `POST /api/generation` and one `OPTIONS /api/generation` per
generation, not two generations.

### A client disconnect does not cancel a generation

The proxy aborted that first attempt at 30s and the teacher saw an error,
but the backend kept working and persisted the draft anyway, at 17:01:56,
about three minutes later. The module is in the emulator with no teacher
ever having seen it.

That is the correct behaviour to have noticed and the wrong behaviour to
leave unexamined. Server side cancellation on client disconnect would
waste the work already done, while persisting an orphan means a teacher who
retried would find two drafts of the same brief. Neither is obviously
right, and the Review Dashboard in Step 4.3 is where a teacher would
encounter it, so the decision belongs there rather than being made silently
here.

### Step 4.2 acceptance result

Gate status: MET. Evidence in
`evaluation/results/dev_runs/goals_screen_demo.json`.

| Path | Result |
|---|---|
| happy | `POST /api/generation` 200 in 179.24s, staged loader shown with all six stages, routed to `/teacher/review/8RVqoallf52n5MkHmltE` |
| timeout | 504 with `retriable: true`, the timeout message shown rather than the generic server error, retry offered, still on the create page, form state fully preserved including both topic chips and the Hebrew free text |

The persisted module was read back out of the emulator: correct title,
subject, grade, `creatorTeacherKey` of `t1`, three lessons, and the five
`qualityScores` keys. R6 was re-checked at the same time across all 15
exercise docs, none of which carries `correctAnswer` or `socraticHints`.

One caveat about the evidence file: the happy record was produced before
the harness learned to record the request method, so it has no
`generation_status` field, while the timeout record does. Its 200 is
visible in that record's `generation_responses` list instead. The run was
not repeated purely to even out a field name.

## Step 4.4 evidence, student dashboard and workspace (2026-11-25)

Gate status: MET. Evidence in
`evaluation/results/dev_runs/student_workspace_demo.json`, 25 checks, all
passing. The acceptance asks for a two browser demo and for an offline
answer to survive a reload, and both are in that file.

### The bug the acceptance run found, and why the unit tests did not

`listenToProgress` was written as a document listener on the derived id
`assignmentKey__studentKey`. It made the workspace unusable on a student's
first visit to any assignment, and three cheaper checks had already passed
over it: it typechecks, it lints, and the nine security rules tests added
for `studentProgress` in this same step all pass.

The rule is

    allow read: if isTeacher() || (isStudent() && resource.data.studentKey == request.auth.uid)

and for a document that does not exist `resource` is null, so
`resource.data` is a null dereference and the read is refused rather than
answered with "no such document". Measured directly against the emulator
with a real student token rather than inferred:

| Read | Result |
|---|---|
| `GET studentProgress/no-such-doc__s01` | `403 PERMISSION_DENIED`, `evaluation error at L67:22 for 'get' @ L67, Null value error` |
| same data via a query on `studentKey` and `assignmentKey` | allowed, empty result |

A student opening a unit for the first time is exactly the missing document
case, so the listener reported permission denied, the page fell into its
forbidden state, and the effect that creates the progress document never
ran because it waits for the listener to report null. The dashboard was
unaffected throughout, because `listenToMyProgress` was already a query.

The rules tests missed it because every one of them read a progress
document that the fixture had already created. The test that now pins it
asserts both halves, that the get is refused and that the query is not, so
nobody can quietly simplify the client back to a get. A list is evaluated
against the query rather than against a document, which is the whole
reason the two reads differ for the same data and the same caller.

Fixed by making the read a query of one document. Writes still address the
document by its derived id, which is where idempotence is needed for the
offline replay (D21).

### Two harness mistakes worth recording, since neither was a product fault

A Firestore REST `PATCH` without an `updateMask` replaces the whole
document. The fixture wrote the module, then added its lessons in a second
PATCH, which left the module holding nothing but `lessons`. The review
screen then threw on `moduleDoc.weeklySequence.length` and rendered
nothing. The screen is reached only through the product in normal use and
the backend always writes that field, so this is a fixture bug, not a
defect, but it does show the review screen has no guard there. Worth a
look in Step 5.1.

Firebase Auth persists its session in IndexedDB per origin and syncs it
across tabs of one browser profile. Running the two roles as two tabs meant
the teacher's sign in replaced the student's session, `ProtectedRoute`
redirected the student page away, and the live card could never arrive,
with the published assignment correct in Firestore and not one console
error anywhere. The demo now uses two isolated browser contexts, which is
also a more honest reading of "two browser demo" than two tabs was. The run
records the student's path and whether the dashboard was still mounted at
the moment of the publish, so a regression here reports itself instead of
looking like a broken listener.

### What the run shows

| Claim | Evidence in the file |
|---|---|
| FR9, NFR3, a publish reaches the student live | teacher publishes through the real Review Dashboard, card appears with no reload, `href` points at the workspace |
| FR10 ordering and progressive disclosure | first exercise in `order`, 0 of 3 scaffold steps rendered initially, 1 then 2 after two requests |
| R6 answer protection through the UI | a canary planted in every `exerciseSolutions` answer and hint is absent from the DOM and from all 25 response bodies the student's page received |
| FR10 gating | next disabled, with the reason shown, until an answer is sent |
| NFR7 | draft on disk while `navigator.onLine` is false, queue holding order 2, Hebrew pending banner, the queued write reaching Firestore on reconnect, and the answer still in the box after a reload |
| FR13 | `currentExerciseOrder` 3, `isCompleted` true, server stamped `completedAt`, completion message shown |
| R1 | the progress screen states that gains come from the pre and post tests rather than showing a number |

The 10 `net::ERR_INTERNET_DISCONNECTED` console errors from the deliberate
disconnect are counted separately as `offlineNoise` rather than filtered
away, so the file says how many there were and why they are not defects.

### A caveat about the rig, not the product

`next build` cannot complete on this machine. It compiles successfully and
then fails twice with `ETIMEDOUT: connection timed out, read` out of
`readFileSync`, once loading the ESLint parser and once collecting page
data. The disk is local APFS with 137GB free, `node_modules` holds no
cloud placeholder files, and there is no security software installed, so
the cause is unidentified and is recorded as unexplained rather than
guessed at. It is the same fault behind the rest of this machine's
behaviour: pandas taking 83s to import, `pip show` over three minutes, and
the rules suite spending 385s collecting one test file whose tests then run
in 9s.

Consequences, stated rather than worked around. The run was served by
`next dev` with every route requested once first, since a cold route
compiles on its first request and that time would land inside the browser's
navigation timeout. The server is recorded in the evidence file. ESLint did
not run in this step, so `next lint` is still owed on a machine that can
finish it, and CI on Linux is the real gate. `tsc --noEmit` passes at exit
0, and the compile step of `next build` passes, so the code is typechecked
and it builds.
