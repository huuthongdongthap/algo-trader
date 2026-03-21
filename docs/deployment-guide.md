# Deployment Guide

## Local Development Setup

### Prerequisites
- Node.js 20.x (native M1 ARM64)
- pnpm 8.x package manager
- SQLite 3.x (included on macOS)
- Git

### Install & Run

```bash
git clone https://github.com/your-org/algo-trade.git
cd algo-trade

# Install dependencies
pnpm install

# Create .env from template
cp .env.example .env

# Start development server
pnpm start
```

Verify:
```bash
curl http://localhost:3000/api/health
open http://localhost:3001  # Dashboard
```

---

## Production Setup (M1 Max MacBook)

### Hardware & OS
- MacBook Pro M1 Max (10-core CPU, 32GB RAM minimum)
- macOS 13.0+ (Ventura or later)
- Stable power supply + UPS recommended

### 1. Server Initialization

```bash
# Update system
softwareupdate -ia

# Install Node.js 20 (ARM64)
brew install node@20

# Install pnpm
brew install pnpm

# Install PM2 globally
npm install -g pm2
pm2 startup
```

### 2. Application Deployment

```bash
# Create app directory
mkdir -p /opt/algo-trade
cd /opt/algo-trade

# Clone repo
git clone https://github.com/your-org/algo-trade.git .

# Install dependencies
pnpm install --frozen-lockfile

# Copy production .env
cp .env.example .env
# Edit .env with production secrets
```

### 3. PM2 Process Management

```bash
# Start processes (ecosystem.config.cjs defines all services)
pm2 start ecosystem.config.cjs

# Verify running
pm2 status

# Save for auto-restart on reboot
pm2 save
pm2 startup
```

Runs:
- `algo-trade-api` (4 workers, port 3000)
- `algo-trade-dashboard` (port 3001)
- `algo-trade-webhook` (port 3002)
- `algo-trade-engine` (in-process)

### 4. Network & DNS (Cloudflare Tunnel)

```bash
# Install cloudflared
curl -L --output cloudflared.tgz https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-arm64.tgz
tar -xzf cloudflared.tgz && sudo mv cloudflared /usr/local/bin/

# Authenticate
cloudflared tunnel login

# Create tunnel
cloudflared tunnel create algo-trade

# Create config: ~/.cloudflared/config.yml
cat > ~/.cloudflared/config.yml << 'EOF'
tunnel: algo-trade
credentials-file: ~/.cloudflared/algo-trade.json
ingress:
  - hostname: cashclaw.cc
    service: http://localhost:3000
  - hostname: dashboard.cashclaw.cc
    service: http://localhost:3001
  - hostname: webhooks.cashclaw.cc
    service: http://localhost:3002
  - service: http_status:404
EOF

# Route DNS
cloudflared tunnel route dns algo-trade cashclaw.cc
cloudflared tunnel route dns algo-trade dashboard.cashclaw.cc
cloudflared tunnel route dns algo-trade webhooks.cashclaw.cc

# Run tunnel
cloudflared tunnel run algo-trade

# Or install as service
sudo cloudflared service install
```

Verify: `curl https://cashclaw.cc/api/health`

### 5. Database & Backups

```bash
# Create data directory
mkdir -p /opt/algo-trade/data

# Database auto-initializes on first run
sqlite3 /opt/algo-trade/data/algo-trade.db ".tables"

# Create backup script
cat > /opt/algo-trade/backup.sh << 'EOFBAK'
#!/bin/bash
BACKUP_DIR="/opt/algo-trade/backups"
DB_PATH="/opt/algo-trade/data/algo-trade.db"
DATE=$(date +\%Y-\%m-\%d_\%H-\%M-\%S)

mkdir -p "$BACKUP_DIR"
cp "$DB_PATH" "$BACKUP_DIR/algo-trade_$DATE.db"

# Keep last 30 days
find "$BACKUP_DIR" -name "*.db" -mtime +30 -delete
EOFBAK

chmod +x /opt/algo-trade/backup.sh

# Schedule daily backup at 2 AM
crontab -e
# Add: 0 2 * * * /opt/algo-trade/backup.sh
```

---

## Environment Variables

Create `.env` in `/opt/algo-trade`:

```bash
# Application
NODE_ENV=production
LOG_LEVEL=info
DB_PATH=./data/algo-trade.db

# Risk Management
MAX_POSITION_SIZE=10000
MAX_DRAWDOWN=0.20
MAX_OPEN_POSITIONS=10
STOP_LOSS_PERCENT=0.10
MAX_LEVERAGE=2

# Polymarket
POLYMARKET_CLOB_URL=https://clob.polymarket.com
POLYMARKET_CHAIN_ID=137
POLYMARKET_PRIVATE_KEY=0x...
POLYGON_RPC_URL=https://polygon-rpc.com

# CEX - Binance
BINANCE_API_KEY=...
BINANCE_API_SECRET=...

# CEX - Bybit
BYBIT_API_KEY=...
BYBIT_API_SECRET=...

# CEX - OKX
OKX_API_KEY=...
OKX_API_SECRET=...
OKX_PASSPHRASE=...

# DEX - Ethereum
ETH_RPC_URL=https://eth-mainnet.g.alchemy.com/v2/...

# DEX - Solana
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com

# Billing (Polar.sh)
POLAR_API_KEY=...
POLAR_PRODUCT_FREE=4551712a
POLAR_PRODUCT_PRO=3a7eff03
POLAR_PRODUCT_ENTERPRISE=d4aba8f3
POLAR_WEBHOOK_SECRET=...

# API Server
API_PORT=3000
JWT_SECRET=your_32_char_secret_key
CORS_ORIGIN=https://cashclaw.cc,https://www.cashclaw.cc

# Dashboard
DASHBOARD_PORT=3001

# Webhooks
WEBHOOK_PORT=3002

# Notifications (optional)
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/...
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/...
TELEGRAM_BOT_TOKEN=...
TELEGRAM_CHAT_ID=...

# Email (SMTP)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=...
SMTP_PASS=...

# Monitoring
METRICS_PORT=9090
```

**SECURITY**: Store `.env` securely, never commit to git.

---

## Monitoring & Health

```bash
# View real-time status
pm2 status
pm2 monit

# Check API health
curl http://localhost:3000/api/health

# View logs
pm2 logs algo-trade-api

# Metrics (Prometheus)
curl http://localhost:9090/metrics
```

---

## Operations

### Graceful Reload (Zero-Downtime)
```bash
pm2 reload all
```

### Restart Services
```bash
pm2 restart all
```

### Deploy New Version
```bash
cd /opt/algo-trade
git pull origin main
pnpm install
pm2 reload all
```

### Disaster Recovery
```bash
# Restore database from backup
cp /opt/algo-trade/backups/algo-trade_YYYY-MM-DD_HH-MM-SS.db \
   /opt/algo-trade/data/algo-trade.db

# Restart services
pm2 restart all
```

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Port in use | `lsof -i :3000` then `kill -9 <PID>` |
| SQLite locked | `pm2 restart algo-trade-api` |
| Polymarket connection fails | Check `POLYMARKET_PRIVATE_KEY` format (0x + 64 hex) |
| Database permission denied | `sudo chown -R $USER /opt/algo-trade/data/` |
| High CPU usage | `pm2 monit` to identify process |

---

## Production Checklist

- [ ] All `.env` secrets configured
- [ ] Database initialized + verified
- [ ] PM2 processes running (`pm2 status`)
- [ ] Cloudflare Tunnel active + DNS resolving
- [ ] Daily backups scheduled (cron)
- [ ] Alerts configured (Slack/Discord)
- [ ] Health endpoint responding
- [ ] Rate limiting tuned per tier
- [ ] Logs rotating (pm2-logrotate)
- [ ] Disaster recovery plan tested

---

## Domain: cashclaw.cc

- **Registrar**: Cloudflare
- **SSL**: Cloudflare managed (auto-renew)
- **DNS**: Cloudflare nameservers
- **Access URLs**:
  - `https://cashclaw.cc` → API (port 3000)
  - `https://dashboard.cashclaw.cc` → Dashboard (port 3001)
  - `https://webhooks.cashclaw.cc` → Webhooks (port 3002)
