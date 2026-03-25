#!/bin/bash
# Bot Watchdog — check if trading bot is alive, restart if dead
# Runs via launchd every 60s on M1 Max
# Bot must never sleep. Bot must self-resurrect.

export PATH=/opt/homebrew/bin:$PATH
cd /Users/macbook/algo-trader || exit 1

LOG=/tmp/algotrade-watchdog.log
TS=$(date '+%Y-%m-%d %H:%M:%S')
BOT_PATTERN="start-trading-bot"
PID_FILE=/tmp/algotrade-bot.pid

# Check if bot process is running
BOT_PID=$(pgrep -f "$BOT_PATTERN" | head -1)

if [ -n "$BOT_PID" ]; then
  # Bot is alive — check if it's responsive (not zombie)
  if kill -0 "$BOT_PID" 2>/dev/null; then
    exit 0
  fi
  echo "[$TS] WATCHDOG: Bot PID $BOT_PID is zombie — killing and restarting" >> $LOG
  kill -9 "$BOT_PID" 2>/dev/null
  sleep 2
fi

echo "[$TS] WATCHDOG: Bot is DEAD — resurrecting..." >> $LOG

# Source env if exists
[ -f /Users/macbook/algo-trader/.env ] && source /Users/macbook/algo-trader/.env

# License keys (fallback if not in .env)
export LICENSE_KEY="${LICENSE_KEY:-eyJ1c2VySWQiOiJ1c2VyXzE3NzQzNDUyNTAwNDgiLCJ0aWVyIjoicHJvIiwiZmVhdHVyZXMiOlsiYmFja3Rlc3RpbmciLCJtdWx0aS1tYXJrZXQiXSwibWF4TWFya2V0cyI6MTAsIm1heFRyYWRlc1BlckRheSI6LTEsImlzc3VlZEF0IjoxNzc0MzQ1MjUwMDQ4LCJleHBpcmVzQXQiOjE3NzY5MzcyNTAwNDh9.2Xf3QZVAPojo4FdmIczHuI9eYBpXj6ruUZZRQCdvafE}"
export LICENSE_SECRET="${LICENSE_SECRET:-cashclaw-dev-secret-2026}"

# Start bot
nohup node scripts/start-trading-bot.mjs \
  --license-key="$LICENSE_KEY" \
  --secret="$LICENSE_SECRET" \
  --dry-run --capital=500 \
  --llm-url=http://localhost:11435/v1 \
  > /tmp/algotrade-bot.log 2>&1 &

NEW_PID=$!
echo "$NEW_PID" > "$PID_FILE"
echo "[$TS] WATCHDOG: Bot resurrected PID=$NEW_PID" >> $LOG

# Verify it started
sleep 3
if kill -0 "$NEW_PID" 2>/dev/null; then
  echo "[$TS] WATCHDOG: Bot confirmed alive PID=$NEW_PID" >> $LOG
else
  echo "[$TS] WATCHDOG: Bot failed to start — check /tmp/algotrade-bot.log" >> $LOG
  exit 1
fi
