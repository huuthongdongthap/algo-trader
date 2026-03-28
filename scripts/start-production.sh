#!/usr/bin/env bash
# Production Startup Script
# Validates environment, checks health, then starts PM2
# Usage: ./scripts/start-production.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_DIR"

echo "=== CashClaw Production Startup ==="
echo "Date: $(date -Iseconds)"
echo "Dir:  $PROJECT_DIR"

# 1. Validate .env exists
if [ ! -f .env ]; then
  echo "[FAIL] .env file not found. Copy .env.example and configure."
  exit 1
fi
echo "[OK] .env found"

# 2. Validate required env vars
REQUIRED_VARS=(
  "DB_HOST"
  "DB_NAME"
  "DB_USER"
  "ADMIN_API_KEY"
)
MISSING=0
for var in "${REQUIRED_VARS[@]}"; do
  if ! grep -q "^${var}=" .env 2>/dev/null; then
    echo "[WARN] Missing env var: $var"
    MISSING=$((MISSING + 1))
  fi
done
if [ "$MISSING" -gt 0 ]; then
  echo "[WARN] $MISSING env vars missing — check .env"
fi
echo "[OK] Environment validated"

# 3. Verify build exists
if [ ! -f dist/app.js ]; then
  echo "[INFO] Building project..."
  pnpm run build
fi
echo "[OK] Build verified: dist/app.js"

# 4. Verify dashboard build
if [ ! -f dashboard/dist/index.html ]; then
  echo "[INFO] Building dashboard..."
  pnpm run dashboard:build
fi
echo "[OK] Dashboard build verified"

# 5. Create required directories
mkdir -p logs data

# 6. Start PM2
echo "[INFO] Starting PM2 processes..."
pm2 start ecosystem.config.cjs --env production

# 7. Wait and health check
echo "[INFO] Waiting 5s for startup..."
sleep 5

API_PORT="${API_PORT:-3000}"
HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:${API_PORT}/health" 2>/dev/null || echo "000")

if [ "$HTTP_STATUS" = "200" ]; then
  echo "[OK] Health check passed (HTTP $HTTP_STATUS)"
else
  echo "[WARN] Health check returned HTTP $HTTP_STATUS"
  echo "[INFO] Checking PM2 status..."
  pm2 status
fi

echo ""
echo "=== Startup Complete ==="
pm2 status
echo ""
echo "Logs: pm2 logs algo-trade"
echo "Stop: pm2 stop all"
