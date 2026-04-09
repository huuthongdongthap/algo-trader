#!/usr/bin/env bash
# Algo-Trader Production Stack — Docker Compose
# Brings up: app + redis + nats + prometheus + grafana
# Usage: ./scripts/start-production.sh [--with-timescaledb] [--detach]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_DIR"

COMPOSE_FILES="-f docker-compose.yml -f docker/monitoring/docker-compose.monitoring.yml"
DETACH=""

for arg in "$@"; do
  case $arg in
    --with-timescaledb)
      COMPOSE_FILES="$COMPOSE_FILES -f docker/timescaledb/docker-compose.timescaledb.yml"
      echo "[+] TimescaleDB enabled"
      ;;
    --detach|-d)
      DETACH="-d"
      ;;
  esac
done

echo "=== Algo-Trader Production Stack ==="
echo "Date: $(date -Iseconds)"
echo "Dir:  $PROJECT_DIR"
echo ""

# Validate .env
if [ ! -f .env ]; then
  echo "[FAIL] .env not found. Run: cp .env.example .env"
  exit 1
fi
echo "[OK] .env found"

# Create shared network (for override files with external: true)
docker network create algo-trader_algo-net 2>/dev/null || true
echo "[OK] Network algo-trader_algo-net ready"

# Pull images
echo "[1/3] Pulling images..."
docker compose $COMPOSE_FILES pull --ignore-buildable 2>&1 | tail -3

# Build app
echo "[2/3] Building algo-trade..."
docker compose $COMPOSE_FILES build algo-trade 2>&1 | tail -3

# Start
echo "[3/3] Starting services..."
docker compose $COMPOSE_FILES up $DETACH

if [ -n "$DETACH" ]; then
  echo ""
  sleep 5
  echo "=== Health Checks ==="
  for svc in algo-trade redis nats; do
    STATUS=$(docker inspect --format='{{.State.Health.Status}}' "algo-trade-${svc}" 2>/dev/null || docker inspect --format='{{.State.Health.Status}}' "${svc}" 2>/dev/null || echo "unknown")
    echo "  $svc: $STATUS"
  done
  echo ""
  echo "=== Endpoints ==="
  echo "  API:        http://localhost:3000"
  echo "  Dashboard:  http://localhost:3001"
  echo "  Grafana:    http://localhost:3030 (admin/changeme)"
  echo "  Prometheus: http://localhost:9090"
  echo "  NATS:       http://localhost:8222"
  echo "  Redis:      localhost:6379"
fi
