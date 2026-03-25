#!/usr/bin/env bash
# Start 14-day dry run paper trading validation
# Usage: bash scripts/start-dry-run.sh [--capital 200] [--interval 900000]
#
# This script:
#   1. Starts paper trading loop in background
#   2. Runs daily report at midnight (or on-demand)
#   3. Validates dry run criteria with dry-run-validator.mjs
#
# Prerequisites:
#   - OLLAMA_HOST and OLLAMA_MODEL set in .env (for AI predictions)
#   - data/ directory exists

set -euo pipefail

CAPITAL="${1:-200}"
INTERVAL="${2:-900000}"
DB_PATH="data/algo-trade.db"
REPORTS_DIR="data/reports"
LOG_FILE="data/paper-trading.log"

echo ""
echo "  ╔══════════════════════════════════════════════╗"
echo "  ║    PHASE 1: 14-DAY DRY RUN VALIDATION        ║"
echo "  ╠══════════════════════════════════════════════╣"
echo "  ║  Capital  : \$${CAPITAL}                         ║"
echo "  ║  Interval : $((INTERVAL / 60000)) min                          ║"
echo "  ║  Database : ${DB_PATH}                   ║"
echo "  ║  Reports  : ${REPORTS_DIR}/                  ║"
echo "  ╚══════════════════════════════════════════════╝"
echo ""

# Ensure directories exist
mkdir -p data/reports

# Check .env exists
if [ ! -f .env ]; then
  echo "  ⚠️  No .env file found. Copying from .env.example..."
  if [ -f .env.example ]; then
    cp .env.example .env
    echo "  ✅ Created .env from template. Edit OLLAMA_HOST/OLLAMA_MODEL before running."
  else
    echo "  ❌ No .env.example found. Create .env with required vars."
    exit 1
  fi
fi

# Ensure PAPER_TRADING=true
if grep -q "PAPER_TRADING=false" .env 2>/dev/null; then
  echo "  ⚠️  Setting PAPER_TRADING=true for dry run..."
  sed -i 's/PAPER_TRADING=false/PAPER_TRADING=true/' .env
fi

echo "  Starting paper trading loop..."
echo "  Log: ${LOG_FILE}"
echo "  Press Ctrl+C to stop"
echo ""
echo "  To check progress at any time:"
echo "    node scripts/daily-report.mjs"
echo "    node scripts/dry-run-validator.mjs --capital ${CAPITAL}"
echo ""

# Run paper trading (foreground so user can Ctrl+C)
exec npx tsx src/cli/index.ts paper \
  --capital "${CAPITAL}" \
  --interval "${INTERVAL}" \
  --db "${DB_PATH}" 2>&1 | tee -a "${LOG_FILE}"
