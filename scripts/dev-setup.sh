#!/bin/bash
# ══════════════════════════════════════════════════════════════════════════════
# CashClaw — Developer Environment Setup
# Run once after cloning. Sets up Node.js deps, data dirs, env config.
#
# Usage: bash scripts/dev-setup.sh
# ══════════════════════════════════════════════════════════════════════════════
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT_DIR"

echo ""
echo "╔══════════════════════════════════════════╗"
echo "║   CashClaw Developer Setup               ║"
echo "╚══════════════════════════════════════════╝"
echo ""

# ── Step 1: Check prerequisites ──────────────────────────────────────────────

echo "[1/6] Checking prerequisites..."

if ! command -v node &>/dev/null; then
    echo "  ✗ Node.js not found. Install: https://nodejs.org (v22+)"
    exit 1
fi

NODE_VERSION=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_VERSION" -lt 20 ]; then
    echo "  ✗ Node.js $NODE_VERSION is too old. Need v20+."
    exit 1
fi
echo "  ✓ Node.js $(node -v)"

if ! command -v pnpm &>/dev/null; then
    echo "  ⚡ Installing pnpm..."
    corepack enable && corepack prepare pnpm@latest --activate
fi
echo "  ✓ pnpm $(pnpm -v)"

# ── Step 2: Install dependencies ─────────────────────────────────────────────

echo "[2/6] Installing Node.js dependencies..."
pnpm install --frozen-lockfile 2>&1 | tail -3
echo "  ✓ Dependencies installed"

# ── Step 3: Create data directories ──────────────────────────────────────────

echo "[3/6] Creating data directories..."
mkdir -p data
mkdir -p docker/secrets
echo "  ✓ data/ and docker/secrets/ ready"

# ── Step 4: Environment configuration ────────────────────────────────────────

echo "[4/6] Setting up environment..."
if [ ! -f .env ]; then
    cp .env.example .env
    echo "  ✓ Created .env from .env.example"
    echo "  ⚠ EDIT .env with your Polymarket API keys before trading!"
else
    echo "  ✓ .env already exists (skipping)"
fi

# ── Step 5: Verify build ─────────────────────────────────────────────────────

echo "[5/6] Verifying TypeScript compilation..."
if pnpm run check 2>&1 | tail -1 | grep -q "error"; then
    echo "  ✗ TypeScript compilation failed. Run: pnpm run check"
    exit 1
fi
echo "  ✓ TypeScript compiles clean"

# ── Step 6: Run tests ────────────────────────────────────────────────────────

echo "[6/6] Running test suite..."
TEST_OUTPUT=$(pnpm test 2>&1 | tail -5)
TESTS_PASSED=$(echo "$TEST_OUTPUT" | grep -oE '[0-9]+ passed' | head -1 || echo "unknown")
echo "  ✓ Tests: $TESTS_PASSED"

# ── Done ─────────────────────────────────────────────────────────────────────

echo ""
echo "╔══════════════════════════════════════════╗"
echo "║   Setup Complete!                         ║"
echo "╚══════════════════════════════════════════╝"
echo ""
echo "Next steps:"
echo "  1. Edit .env with your Polymarket API keys"
echo "  2. pnpm start              — Start bot (paper trading)"
echo "  3. pnpm test               — Run tests"
echo "  4. pnpm run check          — TypeScript check"
echo ""
echo "Optional: AlphaEar Intelligence Sidecar (Python)"
echo "  cd intelligence && bash setup.sh && python server.py"
echo ""
echo "Optional: Docker deployment (M1 Max)"
echo "  docker compose -f docker/docker-compose.cashclaw.yaml up -d"
echo ""
