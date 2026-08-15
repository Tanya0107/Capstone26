# A Tool for Building Enrichment Programs
**Braude College of Engineering — Final Project, Phase B (Code: 26-2-D-7)**
Authors: Naama Burmil, Tanya Noritsin · Advisor: Moran Kupfer

An adaptive AI platform for school enrichment programs across subjects, with math as the primary evaluated subject (see docs/DECISIONS.md D8): a multi-agent curriculum generation
pipeline (FastAPI/Python) with agentic self-correction, an adaptive learning loop
driven by teacher edits (Feedback Memory Bank / RAG), and a Socratic tutoring bot
for students — on a Next.js frontend and Firebase Firestore data layer.

> ⚠️ All evaluation metrics in this repo (BERTScore ≥ 0.80, ROUGE-L ≥ 0.55,
> BLEU ≥ 0.40, IRR ≥ 0.75, CAR ≥ 70%, NGS ≥ 0.30, latency ≤ 15s, uptime ≥ 99.5%)
> are **Phase B targets, not achieved results**. Never present them otherwise.

## Repository layout
```
frontend/     Next.js 14 (App Router, TypeScript, Tailwind) — teacher + student UIs
backend/      FastAPI + LangGraph multi-agent server (Orchestrator, 6-stage pipeline, Socratic loop)
evaluation/   Offline Phase B evaluation harness (NLP metrics, behavioral metrics, IRR, CAR)
firebase/     Firestore security rules, indexes, emulator config
docs/         API contract, open questions, traceability
BUILD_GUIDE.md  Step-by-step build plan for an AI coding agent (start here)
```

## Quick start (after Phase 1 of BUILD_GUIDE.md)
```bash
# Backend
cd backend && python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000

# Frontend
cd frontend && npm install && npm run dev

# Firebase emulators (auth + firestore)
firebase emulators:start
```
