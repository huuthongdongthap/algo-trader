"""AlphaEar Intelligence Sidecar — FastAPI server for CashClaw.

Runs bare metal on M1 Max alongside mlx_lm.server instances.
CashClaw container calls via host.docker.internal:8100.

Router modules:
  news_endpoints.py        → /news/hot, /news/polymarket, /news/content
  prediction_endpoints.py  → /sentiment/*, /predict/forecast, /v1/kronos/*
  signal_tracker_endpoint.py → /signal/track

GET  /health — Health check (this file)
"""

import os
import sys
from contextlib import asynccontextmanager
from pathlib import Path

import uvicorn
from fastapi import FastAPI
from loguru import logger
from pydantic import BaseModel

SCRIPTS_DIR = Path(__file__).parent / "scripts"
if SCRIPTS_DIR.exists():
    sys.path.insert(0, str(SCRIPTS_DIR))

# ──── Health Model ────


class HealthResponse(BaseModel):
    status: str
    kronos_loaded: bool
    finbert_loaded: bool
    news_sources: int
    polymarket_api: bool


# ──── Module References (populated in lifespan) ────

_news_mod = None
_pred_mod = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Initialize all skill modules on startup."""
    global _news_mod, _pred_mod

    logger.info("Starting AlphaEar Intelligence Sidecar...")

    db_manager = None

    # Shared SQLite database
    try:
        from database_manager import DatabaseManager  # noqa: PLC0415
        db_manager = DatabaseManager(
            db_path=str(Path(__file__).parent / "data" / "alphaear.db")
        )
    except Exception as exc:
        logger.warning(f"Database manager not available: {exc}")

    # News tools — injected into news router module
    try:
        from news_tools import NewsNowTools, PolymarketTools  # noqa: PLC0415
        import news_endpoints  # noqa: PLC0415
        news_endpoints.set_tools(
            NewsNowTools(db=db_manager),
            PolymarketTools(db=db_manager),
        )
        _news_mod = news_endpoints
        logger.info("News + Polymarket tools loaded")
    except Exception as exc:
        logger.warning(f"News tools not available: {exc}")

    # Sentiment + Kronos — injected into prediction router module
    try:
        import prediction_endpoints  # noqa: PLC0415

        sentiment = None
        try:
            from sentiment_tools import SentimentTools  # noqa: PLC0415
            sentiment = SentimentTools(db=db_manager, mode="bert")
            logger.info("FinBERT sentiment loaded")
        except Exception as exc:
            logger.warning(f"FinBERT not available: {exc}")

        kronos = None
        try:
            from kronos_engine import KronosEngine  # noqa: PLC0415
            kronos = KronosEngine(model_size="small")
            logger.info("KronosEngine registered (loads on first request)")
        except Exception as exc:
            logger.warning(f"KronosEngine not available: {exc}")

        prediction_endpoints.set_tools(sentiment, kronos)
        _pred_mod = prediction_endpoints
    except Exception as exc:
        logger.warning(f"Prediction endpoints not available: {exc}")

    yield
    logger.info("Shutting down AlphaEar Intelligence Sidecar")


app = FastAPI(
    title="AlphaEar Intelligence Sidecar",
    description="Finance skills for CashClaw trading bot",
    version="1.1.0",
    lifespan=lifespan,
)

# Mount routers
for _name, _mod_name in [
    ("news-endpoints", "news_endpoints"),
    ("prediction-endpoints", "prediction_endpoints"),
    ("signal-tracker", "signal_tracker_endpoint"),
]:
    try:
        import importlib  # noqa: PLC0415
        _mod = importlib.import_module(_mod_name)
        app.include_router(_mod.router)
    except Exception as _e:
        logger.warning(f"{_name} router not loaded: {_e}")


# ──── Health ────


@app.get("/health", response_model=HealthResponse)
async def health():
    n_tools = getattr(_news_mod, "news_tools", None)
    pm_tools = getattr(_news_mod, "polymarket_tools", None)
    k_engine = getattr(_pred_mod, "kronos_engine", None)
    s_tools = getattr(_pred_mod, "sentiment_tools", None)

    pm_ok = False
    if pm_tools:
        try:
            pm_ok = len(pm_tools.get_active_markets(limit=1)) > 0
        except Exception:
            pass

    return HealthResponse(
        status="healthy",
        kronos_loaded=k_engine is not None and k_engine.loaded,
        finbert_loaded=s_tools is not None,
        news_sources=len(getattr(n_tools, "SOURCES", [])) if n_tools else 0,
        polymarket_api=pm_ok,
    )


if __name__ == "__main__":
    uvicorn.run(
        "server:app",
        host="127.0.0.1",
        port=int(os.getenv("SIDECAR_PORT", "8100")),
        reload=False,
        log_level="info",
    )
