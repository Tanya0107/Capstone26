"""FastAPI entrypoint — AI Server Layer (Fig 2, book §System Diagrams).

Routes:
  POST /api/generation      -> 6-stage curriculum pipeline (FR2, FR3, FR4)
  POST /api/tutor/turn      -> Socratic tutoring loop, streamed (FR11, FR12, NFR8)
  POST /api/feedback/edits  -> teacher-edit ingestion into Feedback Memory Bank (FR6)
  GET  /api/analytics/...   -> aggregated telemetry for teacher dashboards (FR8)
"""
import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.config import get_settings
from app.agents.orchestrator import GenerationTimeoutError
from app.api.routes import generation, tutor, feedback, analytics
from app.core.llm import warm_models

settings = get_settings()
logger = logging.getLogger(__name__)


async def _warm_models_background() -> None:
    """Build the provider clients off the request path.

    Construction is synchronous and can be slow, and inside a request it
    would block the event loop and defeat the NFR2 timeout. Warming runs
    in a worker thread so startup and /healthz stay immediate (NFR6).
    """
    try:
        await asyncio.to_thread(warm_models)
        logger.info("LLM clients warmed")
    except Exception:
        # Never fail startup on warming, the first real call reports the error
        logger.exception("LLM client warm up failed")


@asynccontextmanager
async def lifespan(app: FastAPI):
    task = asyncio.create_task(_warm_models_background())
    yield
    task.cancel()


app = FastAPI(
    lifespan=lifespan,
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
