# AlphaEar Intelligence Sidecar

Finance intelligence layer for CashClaw. Wraps [Awesome-finance-skills](https://github.com/RKiding/Awesome-finance-skills) into a FastAPI server.

## Architecture

```
M1 Max bare metal
├── mlx_lm.server :11435 (DeepSeek R1)
├── mlx_lm.server :11436 (Nemotron Nano)
├── alphaear-sidecar :8100 (THIS) ← FastAPI + FinBERT + Kronos
│
└── Docker: cashclaw-bot
    └── calls http://host.docker.internal:8100
```

## Setup

```bash
cd intelligence
chmod +x setup.sh
./setup.sh
python server.py
```

## Endpoints

| Endpoint | Method | Description | Speed |
|----------|--------|-------------|-------|
| `/health` | GET | Health check | <100ms |
| `/news/hot` | POST | 14-source news | ~2s |
| `/news/polymarket` | POST | Market discovery | ~1s |
| `/news/content` | POST | Article extraction | ~3s |
| `/sentiment/analyze` | POST | FinBERT single | ~200ms |
| `/sentiment/batch` | POST | FinBERT batch | ~1s/50 |
| `/predict/forecast` | POST | Kronos forecast | ~5s |
| `/signal/track` | POST | Signal evolution | ~2s |

## launchd (auto-start on macOS)

```bash
# Edit WorkingDirectory in plist to your actual path, then:
cp com.cashclaw.alphaear.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.cashclaw.alphaear.plist
```

## Memory Budget

```
FinBERT:  ~500 MB
Kronos:   ~200 MB (MPS)
FastAPI:  ~100 MB
Total:    ~800 MB
```
