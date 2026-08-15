# Standards Corpus: Israeli MOE Curriculum (D4, D8)

One JSON file per subject under il_moe/, curated by hand from official MOE
curriculum documents. There is no public API, so the corpus is a maintained
snapshot. The three D9 evaluation subjects (math, science, history) are
curated first. Additional subjects are added as their pilots demand.

Curation rules
1. Every entry cites its source document and section.
2. Standard text stays in the original Hebrew.
3. IDs are stable and never reused after deletion. ID scheme: IL-MOE-{SUBJECT}-G{grade}-{domain}-{nn}.
4. Changes go through PR review like code.

The Intake Agent receives the grade slice of the requested subject file and
may only reference IDs that exist in it. Unknown mappings use UNMAPPED with a
rationale. A GenerationRequest whose subject has no corpus file is rejected
with 422 before the pipeline runs.
