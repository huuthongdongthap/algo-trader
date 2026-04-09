"""Kronos Financial Foundation Model Engine.

Wraps shiyu-coder/Kronos pretrained models for OHLCV time-series prediction.
Models hosted at NeoQuasar/Kronos-{mini,small,base} on HuggingFace.

Usage:
    engine = KronosEngine(model_size="small")
    preds = engine.predict_ohlcv(candles, pred_len=5)
"""

import logging
from typing import Optional

import numpy as np
import pandas as pd

logger = logging.getLogger(__name__)


class KronosEngine:
    """Wrapper for Kronos pretrained financial foundation models.

    Supports three model sizes:
      - mini:  4.1M params, max_context=2048, fastest
      - small: 24.7M params, max_context=512, balanced
      - base:  102.3M params, max_context=512, most accurate
    """

    # HuggingFace repo names per model size
    MODEL_REPOS = {
        "mini": "NeoQuasar/Kronos-mini",
        "small": "NeoQuasar/Kronos-small",
        "base": "NeoQuasar/Kronos-base",
    }
    TOKENIZER_REPO = "NeoQuasar/Kronos-Tokenizer-base"
    # Kronos-mini supports longer context window
    MAX_CONTEXT = {"mini": 2048, "small": 512, "base": 512}

    def __init__(self, model_size: str = "small"):
        """
        Args:
            model_size: 'mini' (4.1M), 'small' (24.7M), or 'base' (102.3M).
                        Defaults to 'small' — best balance of speed/accuracy.
        """
        if model_size not in self.MODEL_REPOS:
            raise ValueError(f"model_size must be one of {list(self.MODEL_REPOS)}")

        self.model_size = model_size
        self.model = None
        self.tokenizer = None
        self.predictor = None
        self.device: Optional[str] = None
        self.loaded: bool = False

    def load(self) -> bool:
        """Lazy-load model from HuggingFace Hub.

        Detects Apple Silicon MPS, falls back to CPU.
        Returns True if loaded successfully.
        """
        if self.loaded:
            return True
        try:
            import torch
            from model import Kronos, KronosPredictor, KronosTokenizer  # noqa: PLC0415

            # Prefer MPS on Apple Silicon, else CPU
            if torch.backends.mps.is_available():
                self.device = "mps"
            else:
                self.device = "cpu"

            model_repo = self.MODEL_REPOS[self.model_size]
            logger.info(f"Loading {model_repo} on {self.device}...")

            self.tokenizer = KronosTokenizer.from_pretrained(self.TOKENIZER_REPO)
            self.model = Kronos.from_pretrained(model_repo).to(self.device)

            max_ctx = self.MAX_CONTEXT[self.model_size]
            self.predictor = KronosPredictor(
                self.model, self.tokenizer, max_context=max_ctx
            )
            self.loaded = True
            logger.info(f"Kronos {model_repo} ready on {self.device}")

        except ImportError:
            logger.warning(
                "Kronos package not installed. "
                "Run: pip install git+https://github.com/shiyu-coder/Kronos.git"
            )
            self.loaded = False
        except Exception as exc:
            logger.error(f"Kronos load failed: {exc}")
            self.loaded = False

        return self.loaded

    def predict_ohlcv(
        self, candles: list[dict], pred_len: int = 5
    ) -> Optional[list[dict]]:
        """Predict future OHLCV candles using the Kronos model.

        Args:
            candles: List of dicts with keys: timestamp (ms), open, high, low,
                     close, volume.
            pred_len: Number of future candles to predict (default 5).

        Returns:
            List of {close, high, low, confidence} dicts, or None on failure.
        """
        if not self.loaded and not self.load():
            return None

        try:
            df = pd.DataFrame(candles)
            df["timestamp"] = pd.to_datetime(df["timestamp"], unit="ms")

            x_start = df["timestamp"].iloc[0]
            x_end = df["timestamp"].iloc[-1]

            pred_df = self.predictor.predict(
                df, x_start, x_end, pred_len=pred_len
            )

            results = []
            for _, row in pred_df.iterrows():
                results.append(
                    {
                        "close": float(row.get("close", 0)),
                        "high": float(row.get("high", 0)),
                        "low": float(row.get("low", 0)),
                        "confidence": 0.85,  # default — no model uncertainty available
                    }
                )
            return results

        except Exception as exc:
            logger.error(f"Kronos predict_ohlcv failed: {exc}")
            return None

    def predict_prices(
        self, prices: list[float], pred_len: int = 5
    ) -> Optional[list[dict]]:
        """Simplified prediction from a flat list of close prices.

        Constructs synthetic OHLCV candles (±0.1% spread) and delegates
        to predict_ohlcv. Useful when only close prices are available.

        Args:
            prices: Chronological list of close prices.
            pred_len: Number of future steps to predict.

        Returns:
            List of prediction dicts or None.
        """
        if not prices:
            return None

        now = pd.Timestamp.now()
        candles = [
            {
                "timestamp": int(
                    (now - pd.Timedelta(minutes=len(prices) - i)).timestamp() * 1000
                ),
                "open": p,
                "high": p * 1.001,
                "low": p * 0.999,
                "close": p,
                "volume": 1000,
            }
            for i, p in enumerate(prices)
        ]
        return self.predict_ohlcv(candles, pred_len)
