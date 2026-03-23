# VPS Deployment Guide — algo-trade

## System Requirements

- OS: Ubuntu 22.04+ (LTS)
- Node: 22 LTS (prebuilt binaries for better-sqlite3)
- RAM: 2GB minimum (4GB recommended for live trading)
- Disk: 20GB minimum
- pnpm: 9+

## 1. Provision User

```bash
adduser trader
usermod -aG sudo trader
su - trader
```

## 2. Install Node 22 LTS

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
source ~/.bashrc
nvm install 22
nvm use 22
node -v  # v22.x.x
```

## 3. Install pnpm

```bash
npm install -g pnpm
```

## 4. Clone & Install

```bash
git clone <repo-url> ~/algo-trade
cd ~/algo-trade
pnpm install  # postinstall rebuilds better-sqlite3 for current Node
```

## 5. Configure Environment

```bash
cp .env.example .env
chmod 600 .env
nano .env
```

Required variables:

| Variable | Description |
|----------|-------------|
| `NODE_ENV` | Set to `production` |
| `DB_PATH` | SQLite file path, e.g. `./data/algo-trade.db` |
| `POLYMARKET_PRIVATE_KEY` | Polygon wallet private key |
| `POLYGON_RPC_URL` | RPC endpoint (Alchemy/Infura recommended) |
| `BINANCE_API_KEY` / `BINANCE_API_SECRET` | Binance credentials |
| `BYBIT_API_KEY` / `BYBIT_API_SECRET` | Bybit credentials |
| `OKX_API_KEY` / `OKX_API_SECRET` / `OKX_PASSPHRASE` | OKX credentials |
| `MAX_POSITION_SIZE` | Max USD per position |
| `MAX_DRAWDOWN` | Max drawdown fraction (e.g. 0.20) |

## 6. Create Data Directory

```bash
mkdir -p ~/algo-trade/data
```

## 7. Run

### CLI (interactive)

```bash
cd ~/algo-trade
pnpm start
```

### Daemon via PM2

```bash
npm install -g pm2

pm2 start --name algo-trade --interpreter node \
  --interpreter-args "--import=tsx/esm" \
  src/cli/index.ts

pm2 save
pm2 startup  # follow printed command to enable on boot
```

## 8. Monitoring

```bash
pm2 logs algo-trade          # tail logs
pm2 monit                    # CPU/memory dashboard
pm2 status                   # process status
```

Health check endpoint (if HTTP server enabled):

```bash
curl http://localhost:3000/health
```

## 9. Security Hardening

```bash
# Firewall — allow only SSH
ufw default deny incoming
ufw allow ssh
ufw enable

# .env permissions (owner read-only)
chmod 600 ~/algo-trade/.env

# Never run as root
whoami  # must print: trader (not root)

# Keep Node + deps updated
nvm install 22 && nvm use 22
pnpm update
```

## 10. Updates

```bash
cd ~/algo-trade
git pull origin main
pnpm install        # rebuilds native bindings if Node changed
pm2 restart algo-trade
```
