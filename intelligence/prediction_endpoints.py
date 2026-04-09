"""Prediction & Sentiment Endpoints — FastAPI router.

Extracted from server.py for modular file-size compliance.
Registers:
  /sentiment/analyze, /sentiment/batch
  /predict/forecast (legacy), /v1/kronos/predict-ohlcv
"""

import asyncio
from typing import List

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter()

# Injected by server.py lifespan via set_tools()
sentiment_tools = None
kronos_engine = None


def set_tools(s_tools, k_engine):
    """Inject tool instances from server lifespan."""
    global sentiment_tools, kronos_engine
    sentiment_tools = s_tools
    kronos_engine = k_engine


# ──── Models ────


class SentimentRequest(BaseModel):
    text: str


class BatchSentimentRequest(BaseModel):
    texts: List[str]


class ForecastRequest(BaseModel):
    """Legacy forecast — flat close-price list."""
    prices: List[float]
    lookback: int = 60
    pred_len: int = 5
    news_context: str = ""


class OhlcvCandle(BaseModel):
    timestamp: int
    open: float
    high: float
    low: float
    close: float
    volume: float = 0.0


class KronosPredictRequest(BaseModel):
    candles: List[OhlcvCandle]
    pred_len: int = 5


# ──── Endpoints ────


@router.post("/sentiment/analyze")
async def analyze_sentiment(req: SentimentRequest):
    if not sentiment_tools:
        raise HTTPException(503, "Sentiment tools not loaded")
    try:
        return await asyncio.to_thread(sentiment_tools.analyze_sentiment, req.text)
    except Exception as exc:
        raise HTTPException(500, str(exc))


@router.post("/sentiment/batch")
async def batch_sentiment(req: BatchSentimentRequest):
    if not sentiment_tools:
        raise HTTPException(503, "Sentiment tools not loaded")
    try:
        results = await asyncio.to_thread(
            sentiment_tools.analyze_sentiment_bert, req.texts
        )
        return {"results": results, "count": len(results)}
    except Exception as exc:
        raise HTTPException(500, str(exc))


@router.post("/predict/forecast")
async def forecast(req: ForecastRequest):
    """Legacy endpoint — wraps KronosEngine.predict_prices."""
    if not kronos_engine:
        raise HTTPException(503, "Kronos engine not available")
    try:
        preds = await asyncio.to_thread(
            kronos_engine.predict_prices, req.prices[-req.lookback:], req.pred_len
        )
        if preds is None:
            raise HTTPException(503, "Kronos model not loaded or prediction failed")
        return {
            "forecast": [{"close": p["close"], "high": p["high"], "low": p["low"]} for p in preds],
            "model": f"kronos-{kronos_engine.model_size}",
            "device": kronos_engine.device or "unknown",
        }
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(500, str(exc))


@router.post("/v1/kronos/predict-ohlcv")
async def predict_ohlcv(req: KronosPredictRequest):
    """Full OHLCV prediction via Kronos foundation model.

    Returns predicted future candles with close, high, low, confidence.
    """
    if not kronos_engine:
        raise HTTPException(503, "Kronos engine not available")
    try:
        candles_raw = [c.model_dump() for c in req.candles]
        preds = await asyncio.to_thread(
            kronos_engine.predict_ohlcv, candles_raw, req.pred_len
        )
        if preds is None:
            raise HTTPException(503, "Kronos model not loaded or prediction failed")
        return {
            "predictions": preds,
            "pred_len": req.pred_len,
            "model": f"kronos-{kronos_engine.model_size}",
            "device": kronos_engine.device or "unknown",
        }
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(500, str(exc))
