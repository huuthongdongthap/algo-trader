# Secrets

Create `.env.cashclaw` in this directory (NOT committed to git):

```bash
cp .env.cashclaw.example .env.cashclaw
chmod 600 .env.cashclaw
```

Required variables:

```env
# Polymarket CLOB credentials
POLYMARKET_PRIVATE_KEY=0x...
POLYMARKET_API_KEY=...
POLYMARKET_API_SECRET=...
POLYMARKET_PASSPHRASE=...

# Optional: Claude cloud failover
# CLAUDE_API_KEY=sk-ant-...

# Optional: Telegram alerts
# TELEGRAM_BOT_TOKEN=...
# TELEGRAM_CHAT_ID=...

# Optional: Discord alerts
# DISCORD_WEBHOOK_URL=...
```

NEVER put private keys in docker-compose.yaml or commit them to git.
