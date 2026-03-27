#!/bin/bash
# Pre-build check for algo-trader
# Checks disk space and basic requirements

set -e

echo "Running pre-build checks..."

# Check disk space (require at least 1GB free)
AVAILABLE_DISK=$(df -k . | awk 'NR==2 {print $4}')
MIN_DISK=1048576  # 1GB in KB

if [ "$AVAILABLE_DISK" -lt "$MIN_DISK" ]; then
  echo "ERROR: Insufficient disk space. Required: 1GB, Available: $(($AVAILABLE_DISK / 1024))MB"
  exit 1
fi

echo "Disk space OK: $(($AVAILABLE_DISK / 1024))MB available"

# Check Node.js
if ! command -v node &> /dev/null; then
  echo "ERROR: Node.js is not installed"
  exit 1
fi

NODE_VERSION=$(node -v)
echo "Node.js version: $NODE_VERSION"

# Check pnpm
if ! command -v pnpm &> /dev/null; then
  echo "ERROR: pnpm is not installed"
  exit 1
fi

PNPM_VERSION=$(pnpm -v)
echo "pnpm version: $PNPM_VERSION"

echo "All pre-build checks passed!"
exit 0
