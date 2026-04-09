"""Signal Tracker Endpoint — Nemotron LLM signal evolution assessment.

Extracted from server.py for modular file-size compliance.
Registers a FastAPI router that can be included in the main app.
"""

import os

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter()


class SignalTrackRequest(BaseModel):
    signal_id: str
    original_thesis: str
    new_information: str
    current_price: float
    entry_price: float


@router.post("/signal/track")
async def track_signal(req: SignalTrackRequest):
    """Assess signal evolution via Nemotron Nano LLM.

    Classifies signal as STRENGTHENED, WEAKENED, FALSIFIED, or UNCHANGED
    based on new market information relative to original thesis.
    """
    try:
        import httpx  # noqa: PLC0415

        nemotron_url = os.getenv("LLM_FAST_TRIAGE_URL", "http://127.0.0.1:11436/v1")
        nemotron_model = os.getenv(
            "LLM_FAST_TRIAGE_MODEL",
            "mlx-community/NVIDIA-Nemotron-3-Nano-30B-A3B-4bit",
        )
        pnl_pct = ((req.current_price - req.entry_price) / req.entry_price * 100) if req.entry_price else 0

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

    except Exception as exc:
        raise HTTPException(500, str(exc))
