# AlgoTrade Bot — Setup Instructions

> **For AI Agents:** This file is structured for automated execution.
> Each step has: description, exact commands, and verification.
> Execute steps sequentially. Stop on any verification failure.

## Prerequisites

- **Hardware:** Apple Silicon M1 Max+ 64GB RAM, OR Cloud VPS with RTX 4090 24GB VRAM + 64GB RAM
- **OS:** macOS 14+ (Apple Silicon) or Ubuntu 22.04+ (VPS)
- **Credentials needed from admin:** LICENSE_KEY, LICENSE_SECRET

## Quick Start (5 commands)

```bash
git clone https://github.com/longtho638-jpg/algo-trader.git
cd algo-trader
npm install
npx tsc
cp .env.example .env  # Then edit with your credentials
```

---

## Phase A: Accounts & Crypto (skip if already have USDC + Polymarket account)

### A1. VPN (required for restricted regions)

```bash
# Option 1: Cloudflare WARP (free)
# Download from https://1.1.1.1 → enable WARP

# Option 2: ProtonVPN (free)
# Download from https://protonvpn.com → select US server

# Verify: visit https://polymarket.com — should load without error
```

### A2. MetaMask Wallet

```bash
# Install MetaMask browser extension from https://metamask.io/download
# Create new wallet → SAVE 12 SEED WORDS ON PAPER
# Add Polygon network:
#   Network: Polygon Mainnet
#   RPC: https://polygon-rpc.com
#   Chain ID: 137
#   Symbol: MATIC
#   Explorer: https://polygonscan.com
```

### A3. Buy USDC

```bash
# Binance P2P (works worldwide):
# 1. Register at https://binance.com (email + ID verification)
# 2. Trade → P2P → Buy → USDC → your currency → Bank Transfer
# 3. Buy $500+ USDC
# Recommended: $500 minimum, $2000+ for meaningful returns
```

### A4. Transfer USDC to MetaMask

```bash
# Binance → Wallet → Withdraw → USDC
# Address: your MetaMask address (0x...)
# Network: Polygon (NOT Ethereum!)
# Also withdraw 1 MATIC for gas fees
# IMPORTANT: Always send $1 test first
```

### A5. Create Dedicated Algo Wallet & Export Private Key

```bash
# We highly recommend generating a dedicated wallet for the bot rather than using your main account.
# Run the built-in generator script:
npm run wallet:generate

# Copy the generated Private Key.
# Save it as: POLYMARKET_PRIVATE_KEY=0x... in your .env file
```

### A6. Polymarket Account Login

```bash
# 1. Open MetaMask -> Account Dropdown -> "Add account or hardware wallet" -> "Import account"
# 2. Paste the generated Private Key from Step A5.
# 3. Enable VPN → visit https://polymarket.com
# 4. Log In → Connect Wallet → MetaMask (Select the imported account)
# 
# *NOTE: If MetaMask shows a QR code popup and the browser doesn't automatically redirect/connect, press F5 (Refresh) and try connecting again.*
```

### A7. Generate Polymarket API Keys

```bash
# 1. Deposit at least $10 USDC via Polygon to the newly generated wallet address if you want to trade live.
# 2. Go to Polymarket → Settings → Builder Keys tab → Click "+ Create New"
# 
# IMPORTANT FOR NEW WALLETS: Polymarket will show an "Enable Trading" popup requiring 3 actions:
#   - Deploy Proxy Wallet (Click Deploy & Confirm in MetaMask window)
#   - Enable Trading (Click Sign & Sign in MetaMask window)
#   - Approve Tokens (Click Sign & Sign in MetaMask window)
# 
# Save these 3 values to your .env file:
#   POLYMARKET_API_KEY=...
#   POLYMARKET_API_SECRET=...
#   POLYMARKET_PASSPHRASE=...
# WARNING: API Secret shown only once!
```

---

## Phase B: Bot Installation

### B1. Install Dependencies

**macOS (Apple Silicon):**
```bash
# Install Homebrew (if not installed)
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Install Node.js and Python
brew install node python@3.11

# Install MLX LM server
pip3 install mlx-lm

# Verify
node --version    # v20+
python3 --version # 3.11+
```

**Ubuntu VPS:**
```bash
apt update && apt upgrade -y
apt install -y nvidia-driver-535 nvidia-cuda-toolkit

# Install Ollama
curl -fsSL https://ollama.com/install.sh | sh

# Install Node.js
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs

# Verify
node --version  # v20+
nvidia-smi      # Should show GPU
```

### B2. Download AI Model (~18GB)

**macOS:**
```bash
python3 -m mlx_lm.server \
  --model mlx-community/DeepSeek-R1-Distill-Qwen-32B-4bit \
  --port 11435 &

# Verify (wait for model to load, ~2-5 min first time)
curl http://localhost:11435/v1/models
# Expected: {"data":[{"id":"mlx-community/DeepSeek-R1-Distill-Qwen-32B-4bit"...}]}
```

**Ubuntu VPS:**
```bash
ollama pull deepseek-r1:32b

# Verify
curl http://localhost:11434/api/tags
```

### B3. Clone & Build AlgoTrade

```bash
git clone https://github.com/longtho638-jpg/algo-trader.git
cd algo-trader
npm install
npx tsc

# Verify: should complete with 0 errors
```

### B4. Configure Environment

```bash
cat > .env << 'EOF'
# License (from admin)
LICENSE_KEY=paste-your-license-key
LICENSE_SECRET=paste-your-license-secret

# Polymarket CLOB API (from Step A6)
POLYMARKET_API_KEY=paste-your-api-key
POLYMARKET_PASSPHRASE=paste-your-passphrase

# Wallet (from Step A7)
POLY_PRIVATE_KEY=0xpaste-your-private-key

# Trading
CAPITAL_USDC=500

# LLM (macOS MLX = 11435, VPS Ollama = 11434)
LLM_URL=http://localhost:11435/v1
EOF

# Verify
cat .env
```

### B5. Test Dry Run

```bash
source .env
node scripts/start-trading-bot.mjs \
  --license-key=$LICENSE_KEY \
  --secret=$LICENSE_SECRET \
  --dry-run \
  --capital=$CAPITAL_USDC

# Expected output:
# ╔══════════════════════════════════════════╗
# ║         AlgoTrade Prediction Bot         ║
# ║  License:  ✅ Valid                       ║
# ║  Mode:     DRY RUN (paper)              ║
# ╚══════════════════════════════════════════╝
# 🚀 Starting prediction loop...
#
# Wait ~2 min for first cycle. Ctrl+C to stop.
# SUCCESS = signals appearing with edge percentages
```

### B6. Go Live

```bash
source .env
node scripts/start-trading-bot.mjs \
  --license-key=$LICENSE_KEY \
  --secret=$LICENSE_SECRET \
  --private-key=$POLY_PRIVATE_KEY \
  --capital=$CAPITAL_USDC

# WARNING: This uses real money! Start with $100-200 first.
```

### B7. Run 24/7

**macOS (launchd):**
```bash
# Create service
cat > ~/Library/LaunchAgents/com.algotrade.bot.plist << PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.algotrade.bot</string>
  <key>WorkingDirectory</key><string>$(pwd)</string>
  <key>ProgramArguments</key><array>
    <string>$(which node)</string>
    <string>$(pwd)/scripts/start-trading-bot.mjs</string>
    <string>--dry-run</string>
  </array>
  <key>EnvironmentVariables</key><dict>
    <key>LICENSE_KEY</key><string>$LICENSE_KEY</string>
    <key>LICENSE_SECRET</key><string>$LICENSE_SECRET</string>
    <key>CAPITAL_USDC</key><string>$CAPITAL_USDC</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>/tmp/algotrade-bot.log</string>
  <key>StandardErrorPath</key><string>/tmp/algotrade-bot.log</string>
</dict></plist>
PLIST

launchctl load ~/Library/LaunchAgents/com.algotrade.bot.plist
tail -f /tmp/algotrade-bot.log
```

**Ubuntu VPS (systemd):**
```bash
cat > /etc/systemd/system/algotrade.service << EOF
[Unit]
Description=AlgoTrade Bot
After=network.target ollama.service
[Service]
Type=simple
WorkingDirectory=$(pwd)
EnvironmentFile=$(pwd)/.env
ExecStart=$(which node) scripts/start-trading-bot.mjs
Restart=always
RestartSec=30
[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable algotrade
systemctl start algotrade
journalctl -u algotrade -f
```

### B8. Connect Dashboard (= UI Step 9)

```bash
# Start stats server (port 3000 — serves data to dashboard)
nohup node scripts/stats-server.mjs 3000 data/algo-trade.db > /tmp/stats-server.log 2>&1 &

# Verify stats server is running
curl http://localhost:3000/api/health
# Expected: {"status":"ok",...}

# Create public tunnel (required because dashboard is HTTPS)
brew install cloudflared   # macOS
# apt install cloudflared  # Ubuntu
cloudflared tunnel --url http://localhost:3000

# Copy the https://xxx.trycloudflare.com URL
# Go to: https://cashclaw.cc/dashboard → Settings tab → Bot API URL → paste → Save
#
# IMPORTANT: Both stats-server AND cloudflared must be running
# for the dashboard to show your bot's real data.
# Without this, dashboard shows "Demo mode".
```

---

## Verification Checklist

```bash
# Run these to verify everything works:
node --version                              # v20+
curl http://localhost:11435/v1/models       # LLM responding (macOS)
curl http://localhost:11434/api/tags        # LLM responding (VPS)
cat .env | grep -c '='                     # Should show 6+ lines
node scripts/start-trading-bot.mjs --help  # Should show usage
curl http://localhost:3000/api/health       # Stats server OK
```

## Troubleshooting

| Problem | Cause | Fix |
|---------|-------|-----|
| "fetch failed" on estimation | LLM server not running | Start MLX/Ollama |
| "License expired" | Key past expiry | Contact admin |
| "Order rejected" | Insufficient USDC/MATIC | Fund Polygon wallet |
| Very slow (>2min) | CPU-only inference | Need GPU/Apple Silicon |
| "Cannot find module" | TypeScript not built | Run `npx tsc` |
| Mixed content error | HTTP API on HTTPS page | Use cloudflared tunnel |

## Architecture

```
┌─────────────────────────────────────────┐
│ cashclaw.cc/dashboard  (CF Pages)       │
│  └→ fetches from user's tunnel URL      │
├─────────────────────────────────────────┤
│ cloudflared tunnel (HTTPS)              │
│  └→ proxies to localhost:3000           │
├─────────────────────────────────────────┤
│ stats-server.mjs (port 3000)            │
│  └→ reads algo-trade.db                 │
│  └→ checks LLM status                  │
├─────────────────────────────────────────┤
│ start-trading-bot.mjs                   │
│  ├→ PredictionLoop (scan → estimate)    │
│  ├→ PredictionExecutor (Kelly → order)  │
│  ├→ ClobClient (Polymarket CLOB API)    │
│  └→ DeepSeek R1 via MLX/Ollama         │
└─────────────────────────────────────────┘
```

## For AI Agents

When helping a user set up this bot:
1. Read this SETUP.md first
2. Determine their platform (macOS or VPS)
3. Execute Phase A steps if they don't have crypto accounts
4. Execute Phase B steps sequentially
5. Run verification checklist
6. Each step must pass before proceeding to next
7. The .env file in Step B4 is critical — all credentials go there
8. Always test with --dry-run before live trading
