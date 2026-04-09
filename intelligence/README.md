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
| `/predict/forecast` | POST | Kronos forecast (legacy) | ~5s |
| `/v1/kronos/predict-ohlcv` | POST | Kronos full OHLCV prediction | ~5s |
| `/signal/track` | POST | Signal evolution | ~2s |

## Kronos Foundation Model

[Kronos](https://github.com/shiyu-coder/Kronos) is a financial foundation model trained on 12B+ K-line records from 45+ exchanges.

### Install

```bash
# Install Kronos from source (MIT license)
pip install git+https://github.com/shiyu-coder/Kronos.git

# Install remaining ML deps
pip install -r requirements-kronos.txt
```

### Model sizes

| Size  | Params  | Context | Use case         |
|-------|---------|---------|------------------|
| mini  | 4.1M    | 2048    | Low-latency      |
| small | 24.7M   | 512     | Default (balanced)|
| base  | 102.3M  | 512     | Max accuracy     |

Change model size via `KronosEngine(model_size="base")` in `server.py` lifespan.

### Endpoints

| Endpoint | Description |
|----------|-------------|
| `POST /predict/forecast` | Legacy: close prices → predicted closes |
| `POST /v1/kronos/predict-ohlcv` | Full OHLCV candles → predicted OHLCV |

Models are **lazy-loaded** on first request (downloads from HuggingFace on cold start, ~1–2 min).
MPS acceleration used automatically on Apple Silicon.

## launchd (auto-start on macOS)

```bash
# Edit WorkingDirectory in plist to your actual path, then:
cp com.cashclaw.alphaear.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.cashclaw.alphaear.plist
```

## Memory Budget

```
FinBERT:          ~500 MB
Kronos-mini:      ~50 MB (MPS)
Kronos-small:     ~200 MB (MPS)   ← default
Kronos-base:      ~600 MB (MPS)
FastAPI:          ~100 MB
Total (small):    ~800 MB
Total (base):     ~1.2 GB
```
