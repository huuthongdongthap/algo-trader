"""News & Polymarket Endpoints — FastAPI router.

Extracted from server.py for modular file-size compliance.
Registers /news/hot, /news/polymarket, /news/content routes.
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter()

# Module-level references injected by server.py after import
news_tools = None
polymarket_tools = None


def set_tools(n_tools, pm_tools):
    """Inject tool instances from server lifespan."""
    global news_tools, polymarket_tools
    news_tools = n_tools
    polymarket_tools = pm_tools


class NewsRequest(BaseModel):
    source: str = "wallstreetcn"
    count: int = 15
    fetch_content: bool = False


class PolymarketRequest(BaseModel):
    limit: int = 20


class ContentRequest(BaseModel):
    url: str


@router.post("/news/hot")
async def fetch_hot_news(req: NewsRequest):
    import asyncio  # noqa: PLC0415
    if not news_tools:
        raise HTTPException(503, "News tools not loaded")
    try:
        items = await asyncio.to_thread(
            news_tools.fetch_hot_news, req.source, req.count, req.fetch_content
        )
        return {"items": items, "count": len(items), "source": req.source}
    except Exception as exc:
        raise HTTPException(500, str(exc))


@router.post("/news/polymarket")
async def fetch_polymarket_markets(req: PolymarketRequest):
    import asyncio  # noqa: PLC0415
    if not polymarket_tools:
        raise HTTPException(503, "Polymarket tools not loaded")
    try:
        markets = await asyncio.to_thread(
            polymarket_tools.get_active_markets, req.limit
        )
        return {"markets": markets, "count": len(markets)}
    except Exception as exc:
        raise HTTPException(500, str(exc))


@router.post("/news/content")
async def extract_content(req: ContentRequest):
    import asyncio  # noqa: PLC0415
    if not news_tools:
        raise HTTPException(503, "News tools not loaded")
    try:
        content = await asyncio.to_thread(news_tools.fetch_news_content, req.url)
        return {"content": content, "url": req.url}
    except Exception as exc:
        raise HTTPException(500, str(exc))
