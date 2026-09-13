"""FastAPI entrypoint — AI Server Layer (Fig 2, book §System Diagrams).

Routes:
  POST /api/generation      -> 6-stage curriculum pipeline (FR2, FR3, FR4)
  POST /api/tutor/turn      -> Socratic tutoring loop, streamed (FR11, FR12, NFR8)
  POST /api/feedback/edits  -> teacher-edit ingestion into Feedback Memory Bank (FR6)
  GET  /api/analytics/...   -> aggregated telemetry for teacher dashboards (FR8)
"""
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.config import get_settings
from app.agents.orchestrator import GenerationTimeoutError
from app.api.routes import generation, tutor, feedback, analytics

settings = get_settings()

app = FastAPI(
    title="Enrichment Platform AI Server",
    version="0.1.0",
    description="Multi-agent curriculum generation and Socratic tutoring backend, all subjects (D8).",
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


@app.exception_handler(GenerationTimeoutError)
async def generation_timeout_handler(request: Request, exc: GenerationTimeoutError) -> JSONResponse:
    """NFR2 budget exceeded. Machine readable so the frontend can keep the
    form state and offer a retry (NFR7)."""
    return JSONResponse(
        status_code=504,
        content={"error": "generation_timeout", "retriable": True},
    )


@app.get("/healthz")
async def healthz() -> dict:
    """Liveness probe (used by NFR6 uptime monitoring during load tests)."""
    return {"status": "ok"}
