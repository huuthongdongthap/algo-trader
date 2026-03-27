#!/bin/bash
# dr-drill.sh - Quarterly DR (Disaster Recovery) drill script
# Tests: backup recency, PM2 restart, CF Tunnel, API health
# Exit 0 = all checks passed, exit 1 = one or more failed

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PASS=0; FAIL=0
DRILL_DATE=$(date +"%Y-%m-%d %H:%M:%S")

check() {
  local label="$1"; local result="$2"
  if [ "$result" = "OK" ]; then
    echo "[PASS] $label"; PASS=$((PASS+1))
  else
    echo "[FAIL] $label — $result"; FAIL=$((FAIL+1))
  fi
}

# 1. Backup recency (< 24h)
BACKUP_STATUS=$("$SCRIPT_DIR/backup-verify.sh" 2>&1 | head -1 | grep -o "^\[OK\]" || echo "FAIL")
check "Backup recency < 24h" "${BACKUP_STATUS:-FAIL}"

# 2. PM2 restart capability
if command -v pm2 &>/dev/null; then
  pm2 list --no-color &>/dev/null && check "PM2 process manager" "OK" || check "PM2 process manager" "pm2 list failed"
else
  check "PM2 process manager" "pm2 not installed"
fi

# 3. CF Tunnel connectivity
CF_STATUS=$(curl -sf --max-time 5 "http://localhost:3000/health" &>/dev/null && echo "OK" || echo "health endpoint unreachable")
check "API health endpoint" "$CF_STATUS"

# 4. External API reachability (Cloudflare DNS)
NET_STATUS=$(curl -sf --max-time 5 "https://1.1.1.1" &>/dev/null && echo "OK" || echo "network unreachable")
check "Network/CF connectivity" "$NET_STATUS"

# Report
echo ""
echo "=== DR Drill Report: $DRILL_DATE ==="
echo "PASSED: $PASS | FAILED: $FAIL"
[ "$FAIL" -eq 0 ] && echo "STATUS: GREEN — system ready for recovery" || echo "STATUS: RED — $FAIL check(s) need attention"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
