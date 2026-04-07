#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

echo "[setup] Installing AlphaEar Intelligence Sidecar..."

# Clone skills repo (if not present)
if [ ! -d "skills-repo" ]; then
    echo "[setup] Cloning Awesome-finance-skills..."
    git clone --depth 1 https://github.com/RKiding/Awesome-finance-skills.git skills-repo
fi

# Create flat scripts/ directory with symlinks to skill modules
mkdir -p scripts/predictor

# News tools (from alphaear-news)
SKILL_NEWS="skills-repo/skills/alphaear-news/scripts"
if [ -d "$SKILL_NEWS" ]; then
    for f in news_tools.py database_manager.py content_extractor.py __init__.py; do
        [ -f "$SKILL_NEWS/$f" ] && ln -sf "../$SKILL_NEWS/$f" "scripts/$f"
    done
    echo "[setup] Linked alphaear-news"
fi

# Sentiment tools (from alphaear-sentiment)
SKILL_SENT="skills-repo/skills/alphaear-sentiment/scripts"
if [ -d "$SKILL_SENT" ]; then
    [ -f "$SKILL_SENT/sentiment_tools.py" ] && ln -sf "../$SKILL_SENT/sentiment_tools.py" "scripts/sentiment_tools.py"
    echo "[setup] Linked alphaear-sentiment"
fi

# Predictor (from alphaear-predictor)
SKILL_PRED="skills-repo/skills/alphaear-predictor/scripts"
if [ -d "$SKILL_PRED" ]; then
    [ -f "$SKILL_PRED/kronos_predictor.py" ] && ln -sf "../$SKILL_PRED/kronos_predictor.py" "scripts/kronos_predictor.py"
    [ -d "$SKILL_PRED/predictor" ] && cp -r "$SKILL_PRED/predictor" scripts/ 2>/dev/null || true
    echo "[setup] Linked alphaear-predictor"
fi

# Signal tracker (from alphaear-signal-tracker)
SKILL_SIG="skills-repo/skills/alphaear-signal-tracker/scripts"
if [ -d "$SKILL_SIG" ]; then
    mkdir -p scripts/prompts
    [ -f "$SKILL_SIG/prompts/fin_agent.py" ] && ln -sf "../../$SKILL_SIG/prompts/fin_agent.py" "scripts/prompts/fin_agent.py"
    echo "[setup] Linked alphaear-signal-tracker"
fi

# Ensure data dir exists
mkdir -p data

# Python dependencies (in venv to avoid breaking system packages)
echo "[setup] Installing Python dependencies..."
if [ ! -d ".venv" ]; then
    python3 -m venv .venv
fi
.venv/bin/pip install -q \
    fastapi uvicorn httpx \
    loguru pydantic python-dotenv \
    requests beautifulsoup4 lxml \
    torch torchvision \
    transformers sentencepiece \
    pandas numpy \
    huggingface-hub \
    2>&1 | tail -5

echo ""
echo "[setup] Done. Start with:"
echo "  cd intelligence && .venv/bin/python server.py"
echo ""
echo "Verify: curl http://localhost:8100/health"
