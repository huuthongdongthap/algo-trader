"""AlphaEar Intelligence Sidecar — FastAPI server for CashClaw.

Runs bare metal on M1 Max alongside mlx_lm.server instances.
CashClaw container calls via host.docker.internal:8100.

Endpoints:
  POST /news/hot          — Fetch hot news from 14 sources
  POST /news/polymarket   — Active Polymarket market discovery
  POST /news/content      — Extract article content via Jina
  POST /sentiment/analyze — FinBERT sentiment analysis
  POST /sentiment/batch   — Batch FinBERT analysis
  POST /predict/forecast  — Kronos time-series forecast
  POST /signal/track      — Signal evolution tracking
  GET  /health            — Health check
"""

import os
import sys
import asyncio
from pathlib import Path
from typing import List
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import uvicorn
from loguru import logger

# Add skills scripts to Python path
SCRIPTS_DIR = Path(__file__).parent / "scripts"
if SCRIPTS_DIR.exists():
    sys.path.insert(0, str(SCRIPTS_DIR))

# ──── Request/Response Models ────


class NewsRequest(BaseModel):
    source: str = "wallstreetcn"
    count: int = 15
    fetch_content: bool = False


class PolymarketRequest(BaseModel):
    limit: int = 20


class ContentRequest(BaseModel):
    url: str


class SentimentRequest(BaseModel):
    text: str


class BatchSentimentRequest(BaseModel):
    texts: List[str]


class ForecastRequest(BaseModel):
    prices: List[float]
    lookback: int = 60
    pred_len: int = 5
    news_context: str = ""


class SignalTrackRequest(BaseModel):
    signal_id: str
    original_thesis: str
    new_information: str
    current_price: float
    entry_price: float


class HealthResponse(BaseModel):
    status: str
    kronos_loaded: bool
    finbert_loaded: bool
    news_sources: int
    polymarket_api: bool


# ──── Global State ────

news_tools = None
polymarket_tools = None
sentiment_tools = None
kronos_predictor = None
db_manager = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Initialize all skill modules on startup."""
    global news_tools, polymarket_tools, sentiment_tools, kronos_predictor, db_manager

    logger.info("Starting AlphaEar Intelligence Sidecar...")

    # Initialize shared database
    try:
        from database_manager import DatabaseManager
        db_manager = DatabaseManager(db_path=str(Path(__file__).parent / "data" / "alphaear.db"))
    except Exception as e:
        logger.warning(f"Database manager not available: {e}")

    # News tools (lightweight, always loads)
    try:
        from news_tools import NewsNowTools, PolymarketTools
        news_tools = NewsNowTools(db=db_manager)
        polymarket_tools = PolymarketTools(db=db_manager)
        logger.info("News + Polymarket tools loaded")
    except Exception as e:
        logger.warning(f"News tools not available: {e}")

    # Sentiment tools (FinBERT — may take 30s first time)
    try:
        from sentiment_tools import SentimentTools
        sentiment_tools = SentimentTools(db=db_manager, mode="bert")
        logger.info("FinBERT sentiment loaded")
    except Exception as e:
        logger.warning(f"FinBERT not available: {e}")

    # Kronos predictor (PyTorch + MPS — may take 60s first time)
    try:
        import torch
        device = "mps" if torch.backends.mps.is_available() else "cpu"
        logger.info(f"PyTorch device: {device}")
        from kronos_predictor import KronosPredictorUtility
        kronos_predictor = KronosPredictorUtility(device=device)
        logger.info(f"Kronos predictor loaded on {device}")
    except Exception as e:
        logger.warning(f"Kronos not available: {e}")

    yield
    logger.info("Shutting down AlphaEar Intelligence Sidecar")


app = FastAPI(
    title="AlphaEar Intelligence Sidecar",
    description="Finance skills for CashClaw trading bot",
    version="1.0.0",
    lifespan=lifespan,
)


# ──── Endpoints ────


@app.get("/health", response_model=HealthResponse)
async def health():
    pm_ok = False
    if polymarket_tools:
        try:
            markets = polymarket_tools.get_active_markets(limit=1)
            pm_ok = len(markets) > 0
        except Exception:
            pass

    return HealthResponse(
        status="healthy",
        kronos_loaded=kronos_predictor is not None,
        finbert_loaded=sentiment_tools is not None,
        news_sources=len(getattr(news_tools, "SOURCES", [])) if news_tools else 0,
        polymarket_api=pm_ok,
    )


@app.post("/news/hot")
async def fetch_hot_news(req: NewsRequest):
    if not news_tools:
        raise HTTPException(503, "News tools not loaded")
    try:
        items = await asyncio.to_thread(
            news_tools.fetch_hot_news, req.source, req.count, req.fetch_content
        )
        return {"items": items, "count": len(items), "source": req.source}
    except Exception as e:
        raise HTTPException(500, str(e))


@app.post("/news/polymarket")
async def fetch_polymarket_markets(req: PolymarketRequest):
    if not polymarket_tools:
        raise HTTPException(503, "Polymarket tools not loaded")
    try:
        markets = await asyncio.to_thread(
            polymarket_tools.get_active_markets, req.limit
        )
        return {"markets": markets, "count": len(markets)}
    except Exception as e:
        raise HTTPException(500, str(e))


@app.post("/news/content")
async def extract_content(req: ContentRequest):
    if not news_tools:
        raise HTTPException(503, "News tools not loaded")
    try:
        content = await asyncio.to_thread(
            news_tools.fetch_news_content, req.url
        )
        return {"content": content, "url": req.url}
    except Exception as e:
        raise HTTPException(500, str(e))


@app.post("/sentiment/analyze")
async def analyze_sentiment(req: SentimentRequest):
    if not sentiment_tools:
        raise HTTPException(503, "Sentiment tools not loaded")
    try:
        result = await asyncio.to_thread(
            sentiment_tools.analyze_sentiment, req.text
        )
        return result
    except Exception as e:
        raise HTTPException(500, str(e))


@app.post("/sentiment/batch")
async def batch_sentiment(req: BatchSentimentRequest):
    if not sentiment_tools:
        raise HTTPException(503, "Sentiment tools not loaded")
    try:
        results = await asyncio.to_thread(
            sentiment_tools.analyze_sentiment_bert, req.texts
        )
        return {"results": results, "count": len(results)}
    except Exception as e:
        raise HTTPException(500, str(e))


@app.post("/predict/forecast")
async def forecast(req: ForecastRequest):
    if not kronos_predictor:
        raise HTTPException(503, "Kronos predictor not loaded")
    try:
        import pandas as pd
        df = pd.DataFrame({"close": req.prices})
        result = await asyncio.to_thread(
            kronos_predictor.get_base_forecast,
            df, req.lookback, req.pred_len, req.news_context
        )
        return {
            "forecast": [
                {"close": p.close, "high": p.high, "low": p.low}
                for p in result
            ],
            "model": "kronos",
            "device": str(kronos_predictor.device),
        }
    except Exception as e:
        raise HTTPException(500, str(e))


@app.post("/signal/track")
async def track_signal(req: SignalTrackRequest):
    """Signal evolution assessment via Nemotron LLM."""
    try:
        import httpx
        nemotron_url = os.getenv("LLM_FAST_TRIAGE_URL", "http://127.0.0.1:11436/v1")
        nemotron_model = os.getenv(
            "LLM_FAST_TRIAGE_MODEL",
            "mlx-community/NVIDIA-Nemotron-3-Nano-30B-A3B-4bit",
        )
        pnl_pct = (req.current_price - req.entry_price) / req.entry_price * 100

        prompt = (
            f"Assess signal evolution for this trading position:\n\n"
            f"Signal ID: {req.signal_id}\n"
            f"Original thesis: {req.original_thesis}\n"
            f"New information: {req.new_information}\n"
            f"Entry price: {req.entry_price}\n"
            f"Current price: {req.current_price}\n"
            f"P&L: {pnl_pct:.1f}%\n\n"
            f"Classify: STRENGTHENED, WEAKENED, FALSIFIED, or UNCHANGED.\n"
            f'Respond with JSON: {{"status": "...", "confidence": 0.X, "reasoning": "..."}}'
        )

        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(
                f"{nemotron_url}/chat/completions",
                json={
                    "model": nemotron_model,
                    "messages": [{"role": "user", "content": prompt}],
                    "max_tokens": 512,
                    "temperature": 0.3,
                },
            )
            data = resp.json()
            content = data["choices"][0]["message"]["content"]
            return {"analysis": content, "model": "nemotron-nano"}

    except Exception as e:
        raise HTTPException(500, str(e))


if __name__ == "__main__":
    uvicorn.run(
        "server:app",
        host="127.0.0.1",
        port=int(os.getenv("SIDECAR_PORT", "8100")),
        reload=False,
        log_level="info",
    )
