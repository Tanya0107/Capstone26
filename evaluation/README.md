# Phase B Evaluation Harness (offline)

Computes the project's success-criteria metrics against the thresholds in
`thresholds.yaml`. **All thresholds are TARGETS until real runs prove
otherwise — never report them as achieved without a results file.**

Pipeline:
1. Author >= 5 gold-standard enrichment units in `gold_standard/` (JSON,
   CurriculumPackage-shaped). OPEN QUESTION Q8: who authors/validates them?
2. `python generate_candidates.py` — produce AI drafts for the same briefs.
3. `python compute_nlp_metrics.py` — BERTScore / ROUGE-L / BLEU vs references.
4. `python critic_stress_test.py` — planted-flaw detection accuracy (FR3).
5. `python compute_irr.py ratings.csv` — Fleiss' kappa across 3 expert raters.
6. `python compute_behavioral_metrics.py telemetry_export.json` — ATT/TCV/HSR/NGS
   from the pilot (>= 10 students, book §Testing Process).
7. `python report.py` — single results.json + pass/fail table vs thresholds.
