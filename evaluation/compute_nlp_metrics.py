"""BERTScore, ROUGE-L and BLEU between AI drafts and gold standard references.

Usage: python compute_nlp_metrics.py --candidates out/ --references gold_standard/

Hebrew specific requirements (docs/DECISIONS.md D5, D6). These are mandatory,
not suggestions. Scoring Hebrew with English defaults invalidates the targets.

1. BERTScore: score with model_type xlm-roberta-large. The package default
   roberta-large is English only. Record the scorer model and version in the
   output metadata. Scores are not comparable across scorer models.
2. ROUGE-L: the default rouge_score tokenizer strips non Latin characters.
   Pass a custom tokenizer that preserves Hebrew (simple whitespace plus
   punctuation split is acceptable). Record the tokenizer in metadata.
3. BLEU: use sacrebleu with tokenize set to intl so Hebrew unicode is handled.
4. Compare like with like: objectives against objectives, exercise prompts
   against prompts. Never whole packages as one blob.
5. Report per unit, per subject and overall means (D9). Similarity metrics
   do not detect factual errors, so results are reported alongside the critic
   stress test accuracy for the same subject type. Output goes to
   evaluation/results/nlp_metrics.json with pass or fail against
   thresholds.yaml. Targets remain targets until this file exists (rule R1).
"""

if __name__ == "__main__":
    raise SystemExit("TODO Phase 5, Step 5.3")
