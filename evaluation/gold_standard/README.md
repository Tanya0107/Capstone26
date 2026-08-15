# Gold standard reference units

Manually authored, teacher validated enrichment units. All content in Hebrew
(D5). See unit_01_math_fractions_g5.json for a complete worked example and
TEMPLATE_unit.json for authoring new units.

## Structure

A reference is the content bearing subset of CurriculumPackage plus a
reference_metadata block. Pipeline artifacts (critic_report, quality_scores,
latency) do not exist for human authored content and are omitted.

reference_metadata is mandatory and answers the circularity question:
  content_source     where the material came from (published, MOE approved)
  adapted_by         who converted it to JSON (conversion only, no authoring)
  llm_involvement    must be none. LLM touched references invalidate BERTScore
  validated_by       the subject competent teacher who signed off
  validation_date    when. A unit with status DRAFT never enters a metric run

## Subject coverage (D9 stratified sampling)

  Subject   Type          Units   Validated by
  math      quantitative  2       subject competent teacher (Q8)
  science   mixed         2       subject competent teacher (Q8)
  history   open ended    1       subject competent teacher (Q8)

## What gets scored against what (compute_nlp_metrics.py)

Like with like, per unit:
  reference lessons[].objectives   vs candidate lessons[].objectives
  reference exercises[].prompt     vs candidate exercises[].prompt
  reference weekly_sequence        vs candidate weekly_sequence
Fields not listed here are not scored, but hints and assessment still matter:
they are covered by the critic stress test and the expert rubric.

Every unit_NN file has a matching brief_NN.json, the GenerationRequest that
should produce comparable content. The same briefs drive generate_candidates.py.

Reminder: ROUGE, BLEU and BERTScore measure similarity to these references,
not factual correctness. Report them together with critic stress test
accuracy for the same subject type.
