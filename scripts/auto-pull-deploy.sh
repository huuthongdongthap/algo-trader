#!/bin/bash
# Auto-pull from GitHub and restart bot if new commits detected
# Runs via launchd every 10 minutes on M1 Max

export PATH=/opt/homebrew/bin:$PATH
cd /Users/macbook/algo-trader || exit 1

LOG=/tmp/algotrade-auto-pull.log
TS=$(date '+%Y-%m-%d %H:%M:%S')

# Fetch latest
git fetch origin main --quiet 2>/dev/null

# Check if behind
LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse origin/main)

if [ "$LOCAL" = "$REMOTE" ]; then
  echo "[$TS] No changes" >> $LOG
  exit 0
fi

echo "[$TS] New commits detected: $LOCAL -> $REMOTE" >> $LOG

# Pull and build
git pull origin main --ff-only >> $LOG 2>&1
if [ $? -ne 0 ]; then
  echo "[$TS] Pull failed — manual intervention needed" >> $LOG
  exit 1
fi

npx tsc >> $LOG 2>&1
if [ $? -ne 0 ]; then
  echo "[$TS] Build failed — not restarting bot" >> $LOG
  exit 1
fi

echo "[$TS] Build OK — restarting bot" >> $LOG

# Kill old bot
kill $(ps aux | grep 'start-trading-bot' | grep -v grep | awk '{print $2}') 2>/dev/null
sleep 2

# Restart bot
export LICENSE_KEY='eyJ1c2VySWQiOiJ1c2VyXzE3NzQzNDUyNTAwNDgiLCJ0aWVyIjoicHJvIiwiZmVhdHVyZXMiOlsiYmFja3Rlc3RpbmciLCJtdWx0aS1tYXJrZXQiXSwibWF4TWFya2V0cyI6MTAsIm1heFRyYWRlc1BlckRheSI6LTEsImlzc3VlZEF0IjoxNzc0MzQ1MjUwMDQ4LCJleHBpcmVzQXQiOjE3NzY5MzcyNTAwNDh9.2Xf3QZVAPojo4FdmIczHuI9eYBpXj6ruUZZRQCdvafE'
export LICENSE_SECRET='cashclaw-dev-secret-2026'

nohup node scripts/start-trading-bot.mjs \
  --license-key="$LICENSE_KEY" \
  --secret="$LICENSE_SECRET" \
  --dry-run --capital=500 \
  --llm-url=http://localhost:11435/v1 \
  > /tmp/algotrade-bot.log 2>&1 &

echo "[$TS] Bot restarted PID: $!" >> $LOG
