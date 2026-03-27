#!/bin/bash
# uptime-check.sh - Monitor CashClaw endpoints every 5 minutes via cron
# Cron example: */5 * * * * /path/to/scripts/uptime-check.sh
# Log output:   /var/log/cashclaw-uptime.log

LOG_FILE="${UPTIME_LOG:-/tmp/cashclaw-uptime.log}"
TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')
ALERT_SENT=0

check_endpoint() {
  local name="$1"
  local url="$2"
  local status

  status=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "$url")

  if [ "$status" = "200" ]; then
    echo "[$TIMESTAMP] OK $name → HTTP $status" >> "$LOG_FILE"
  else
    echo "[$TIMESTAMP] DOWN $name → HTTP $status (expected 200)" >> "$LOG_FILE"
    ALERT_SENT=1
    # Extend: hook Telegram/Discord webhook here
    # curl -s -X POST "$TELEGRAM_WEBHOOK" -d "text=ALERT: $name DOWN (HTTP $status)"
  fi
}

# Endpoints to monitor
check_endpoint "cashclaw.cc"              "https://cashclaw.cc"
check_endpoint "api.cashclaw.cc/health"   "https://api.cashclaw.cc/api/health"

# Print summary to stdout for cron mail
if [ "$ALERT_SENT" -eq 1 ]; then
  echo "ALERT: One or more endpoints DOWN at $TIMESTAMP — see $LOG_FILE"
  exit 1
else
  echo "OK: All endpoints healthy at $TIMESTAMP"
  exit 0
fi
