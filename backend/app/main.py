"""FastAPI entrypoint — AI Server Layer (Fig 2, book §System Diagrams).

Routes:
  POST /api/generation      -> 6-stage curriculum pipeline (FR2, FR3, FR4)
  POST /api/tutor/turn      -> Socratic tutoring loop, streamed (FR11, FR12, NFR8)
  POST /api/feedback/edits  -> teacher-edit ingestion into Feedback Memory Bank (FR6)
  GET  /api/analytics/...   -> aggregated telemetry for teacher dashboards (FR8)
"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.api.routes import generation, tutor, feedback, analytics

settings = get_settings()

app = FastAPI(
    title="Math Enrichment Platform — AI Server",
    version="0.1.0",
    description="Multi-agent curriculum generation and Socratic tutoring backend.",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.frontend_origin],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(generation.router, prefix="/api/generation", tags=["generation"])
app.include_router(tutor.router, prefix="/api/tutor", tags=["tutor"])
app.include_router(feedback.router, prefix="/api/feedback", tags=["feedback"])
app.include_router(analytics.router, prefix="/api/analytics", tags=["analytics"])


@app.get("/healthz")
async def healthz() -> dict:
    """Liveness probe (used by NFR6 uptime monitoring during load tests)."""
    return {"status": "ok"}
