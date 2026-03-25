# CashClaw Bot — Customer Deployment SOP

> Self-hosting guide for prediction market trading bot.
> Two options: Apple Silicon Mac or Cloud VPS.

---

## Quick Decision Matrix

| Factor | Option A: Apple Silicon | Option B: Cloud VPS |
|--------|------------------------|---------------------|
| Hardware cost | $2,400-3,200 one-time | $150-400/month |
| Inference cost | $0 (local MLX) | $0 (local Ollama) |
| Latency | ~33s/prediction | ~45-60s/prediction |
| Setup difficulty | Easy (brew install) | Medium (Docker) |
| Best for | Long-term (>6 months) | Quick start, testing |
| Min spec | M1 Max 64GB | 64GB RAM, RTX 4090 |

---

## Option A: Apple Silicon Mac (Recommended)

### Minimum Hardware

| Component | Minimum | Recommended | Why |
|-----------|---------|-------------|-----|
| Chip | M1 Max / M2 Pro | M2 Max / M3 Max | Unified memory bandwidth |
| RAM | 64GB | 64-96GB | DeepSeek R1 32B 4-bit = ~18GB + OS + Node.js = ~24GB min |
| Storage | 256GB SSD | 512GB+ | Model files ~20GB |
| macOS | 14.0+ | 15.0+ | MLX framework support |

**Why Apple Silicon?** Unified memory = GPU + CPU share same RAM. No PCIe bottleneck. MLX framework optimized for Apple Neural Engine. DeepSeek R1 32B 4-bit runs at 17 tok/s on M1 Max vs 8-12 tok/s on RTX 3090.

### Step-by-Step Setup

#### 1. Install Dependencies

```bash
# Xcode command line tools
xcode-select --install

# Homebrew
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Node.js 20+ and Python 3.11+
brew install node python@3.11

# MLX LM server (Apple's ML framework)
pip3 install mlx-lm
```

#### 2. Download DeepSeek R1 Model

```bash
# Download model (~18GB, takes 10-30 min depending on connection)
python3 -m mlx_lm.server \
  --model mlx-community/DeepSeek-R1-Distill-Qwen-32B-4bit \
  --port 11435 &

# Verify model loaded
curl http://localhost:11435/v1/models
# Should show: {"data":[{"id":"mlx-community/DeepSeek-R1-Distill-Qwen-32B-4bit"...}]}
```

#### 3. Clone and Setup CashClaw

```bash
git clone https://github.com/longtho638-jpg/algo-trader.git
cd algo-trader
npm install
npx tsc  # Build TypeScript → dist/
```

#### 4. Configure Environment

```bash
# Create .env file
cat > .env << 'EOF'
# LLM (local MLX server)
LLM_PRIMARY_URL=http://127.0.0.1:11435/v1
LLM_PRIMARY_MODEL=mlx-community/DeepSeek-R1-Distill-Qwen-32B-4bit

# License (provided by admin)
LICENSE_KEY=your-license-key-here
LICENSE_SECRET=your-secret-here

# Polymarket wallet (for live trading only)
POLY_PRIVATE_KEY=0x...your-polygon-wallet-private-key...

# Capital
CAPITAL_USDC=500
EOF
```

#### 5. Test with Dry Run

```bash
# Source env vars
source .env

# Dry run — no real money, validates everything works
node scripts/start-trading-bot.mjs \
  --license-key=$LICENSE_KEY \
  --secret=$LICENSE_SECRET \
  --dry-run \
  --capital=$CAPITAL_USDC

# Expected output:
# ╔══════════════════════════════════════════╗
# ║         CashClaw Prediction Bot         ║
# ║  License:  ✅ Valid                       ║
# ║  Mode:     DRY RUN (paper)              ║
# ╚══════════════════════════════════════════╝
# 🚀 Starting prediction loop...
```

#### 6. Go Live

```bash
# Live mode — uses real USDC on Polymarket
node scripts/start-trading-bot.mjs \
  --license-key=$LICENSE_KEY \
  --secret=$LICENSE_SECRET \
  --private-key=$POLY_PRIVATE_KEY \
  --capital=500
```

#### 7. Run as Background Service (persist across reboots)

```bash
# Create launchd plist
cat > ~/Library/LaunchAgents/com.algotrade.bot.plist << 'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.algotrade.bot</string>
  <key>ProgramArguments</key>
  <array>
    <string>/opt/homebrew/bin/node</string>
    <string>/Users/YOUR_USER/algo-trader/scripts/start-trading-bot.mjs</string>
    <string>--dry-run</string>
  </array>
  <key>WorkingDirectory</key>
  <string>/Users/YOUR_USER/algo-trader</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>LICENSE_KEY</key>
    <string>your-key</string>
    <key>LICENSE_SECRET</key>
    <string>your-secret</string>
    <key>CAPITAL_USDC</key>
    <string>500</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>/tmp/algotrade-bot.log</string>
  <key>StandardErrorPath</key>
  <string>/tmp/algotrade-bot.log</string>
</dict>
</plist>
EOF

# Load service
launchctl load ~/Library/LaunchAgents/com.algotrade.bot.plist

# Check logs
tail -f /tmp/algotrade-bot.log
```

---

## Option B: Cloud VPS

### Minimum VPS Specs

| Component | Minimum | Recommended | Notes |
|-----------|---------|-------------|-------|
| **GPU** | RTX 3090 (24GB) | RTX 4090 (24GB) or A100 (40GB) | MUST have ≥24GB VRAM for 32B 4-bit |
| **RAM** | 32GB | 64GB | Model loading + Node.js overhead |
| **CPU** | 8 cores | 16 cores | For market scanning + data processing |
| **Storage** | 100GB SSD | 200GB NVMe | Model files + database |
| **Network** | 100Mbps | 1Gbps | Polymarket API + model download |
| **OS** | Ubuntu 22.04 LTS | Ubuntu 24.04 LTS | CUDA driver support |

### GPU Memory Requirements

| Model | VRAM Required | Speed | Accuracy |
|-------|--------------|-------|----------|
| DeepSeek-R1-Distill-Qwen-32B-4bit | ~18GB | ~8-12 tok/s (CUDA) | Best (validated) |
| DeepSeek-R1-Distill-Qwen-14B-4bit | ~8GB | ~20-30 tok/s | Good (untested) |
| Qwen2.5-Coder-32B-Instruct-4bit | ~18GB | ~15-20 tok/s | Overconfident |

**WARNING:** DeepSeek R1 32B 4-bit is the ONLY validated model. Using smaller models may reduce prediction accuracy.

### Recommended VPS Providers

| Provider | Plan | GPU | RAM | Price/mo | Notes |
|----------|------|-----|-----|----------|-------|
| **RunPod** | GPU Pod | RTX 4090 24GB | 64GB | ~$150-200 | Best value, spot pricing |
| **Lambda** | 1x GPU | RTX 4090 or A6000 | 64GB | ~$200-300 | Reliable, US-based |
| **Vast.ai** | Marketplace | RTX 3090/4090 | 32-64GB | ~$100-250 | Cheapest, variable |
| **Hetzner** | GPU Server | RTX 4000 SFF | 64GB | ~$180 | EU, good connectivity |
| **DigitalOcean** | GPU Droplet | H100 80GB | 240GB | ~$400 | Overkill but reliable |

**CPU-only alternative (slow but works):**

| Provider | Plan | RAM | Price/mo | Speed |
|----------|------|-----|----------|-------|
| Hetzner AX102 | Dedicated | 128GB DDR5 | ~$100 | ~2-3 tok/s (llama.cpp CPU) |

### Step-by-Step VPS Setup

#### 1. Provision Server

```bash
# SSH into your VPS
ssh root@YOUR_VPS_IP

# Update system
apt update && apt upgrade -y
```

#### 2. Install NVIDIA Drivers + CUDA (GPU VPS only)

```bash
# Install NVIDIA driver
apt install -y nvidia-driver-535 nvidia-cuda-toolkit

# Verify GPU
nvidia-smi
# Should show your GPU with available VRAM
```

#### 3. Install Ollama (easiest for VPS)

```bash
# One-line install
curl -fsSL https://ollama.com/install.sh | sh

# Pull DeepSeek R1 model (~18GB download)
ollama pull deepseek-r1:32b

# Start server (default port 11434)
ollama serve &

# Verify
curl http://localhost:11434/api/tags
```

**Alternative: vLLM (faster, more control)**

```bash
pip install vllm
python -m vllm.entrypoints.openai.api_server \
  --model deepseek-ai/DeepSeek-R1-Distill-Qwen-32B \
  --quantization awq \
  --port 11435 \
  --gpu-memory-utilization 0.9
```

#### 4. Install Node.js + CashClaw

```bash
# Install Node.js 20+
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs

# Clone repo
git clone https://github.com/longtho638-jpg/algo-trader.git
cd algo-trader
npm install
npx tsc
```

#### 5. Configure

```bash
cat > .env << 'EOF'
# LLM (local Ollama)
LLM_PRIMARY_URL=http://127.0.0.1:11434/v1
LLM_PRIMARY_MODEL=deepseek-r1:32b

# License
LICENSE_KEY=your-license-key
LICENSE_SECRET=your-secret

# Polymarket
POLY_PRIVATE_KEY=0x...

# Capital
CAPITAL_USDC=500
EOF
```

**NOTE:** If using Ollama (port 11434) instead of MLX (port 11435), update `LLM_PRIMARY_URL` accordingly. The bot uses OpenAI-compatible `/v1/chat/completions` endpoint — both Ollama and MLX support this.

#### 6. Test and Go Live

```bash
source .env

# Dry run first
node scripts/start-trading-bot.mjs \
  --license-key=$LICENSE_KEY \
  --secret=$LICENSE_SECRET \
  --dry-run

# Live trading
node scripts/start-trading-bot.mjs \
  --license-key=$LICENSE_KEY \
  --secret=$LICENSE_SECRET \
  --private-key=$POLY_PRIVATE_KEY \
  --capital=500 \
  --llm-url=http://127.0.0.1:11434/v1
```

#### 7. Run as systemd Service

```bash
cat > /etc/systemd/system/algotrade.service << 'EOF'
[Unit]
Description=CashClaw Prediction Bot
After=network.target ollama.service

[Service]
Type=simple
User=root
WorkingDirectory=/root/algo-trader
EnvironmentFile=/root/algo-trader/.env
ExecStart=/usr/bin/node scripts/start-trading-bot.mjs --dry-run
Restart=always
RestartSec=30

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable algotrade
systemctl start algotrade

# Check status
systemctl status algotrade
journalctl -u algotrade -f
```

---

## Polymarket Wallet Setup

### Create Polygon Wallet

```bash
# Generate new wallet (SAVE PRIVATE KEY SECURELY!)
node -e "
const { Wallet } = require('ethers');
const w = Wallet.createRandom();
console.log('Address:', w.address);
console.log('Private Key:', w.privateKey);
console.log('SAVE THIS PRIVATE KEY! You cannot recover it.');
"
```

### Fund Wallet

1. Buy USDC on any exchange (Coinbase, Binance)
2. Send USDC to your Polygon wallet address via **Polygon network** (not Ethereum!)
3. Also send ~0.5 MATIC for gas fees
4. Verify balance: https://polygonscan.com/address/YOUR_ADDRESS

### Polymarket CLOB Access

1. Go to https://polymarket.com
2. Connect your Polygon wallet
3. Complete any required verification
4. The bot will use your wallet's private key to sign CLOB orders

---

## Monitoring & Troubleshooting

### Log Locations

| Component | Mac | VPS |
|-----------|-----|-----|
| Bot | /tmp/algotrade-bot.log | journalctl -u algotrade |
| LLM | Terminal output | journalctl -u ollama |
| Resolution check | /tmp/resolution-check.log | Same path |

### Common Issues

| Symptom | Cause | Fix |
|---------|-------|-----|
| "fetch failed" on estimation | LLM server not running | Start MLX/Ollama server |
| "License expired" | Key past expiresAt | Contact admin for renewal |
| "Order rejected" | Insufficient USDC or MATIC | Fund Polygon wallet |
| Bot hangs on first cycle | Model loading (first run) | Wait 2-5 min for model load |
| Very slow predictions (>2min) | CPU-only inference | Need GPU or Apple Silicon |
| "CLOB API 401" | Wrong API credentials | Check POLY_PRIVATE_KEY |

### Health Checks

```bash
# Check LLM is responding
curl -s http://localhost:11435/v1/models | head -1

# Check Polymarket API
curl -s https://gamma-api.polymarket.com/markets?limit=1 | head -1

# Check bot process
ps aux | grep start-trading-bot

# Check wallet balance (requires ethers)
node -e "
const { JsonRpcProvider, formatUnits } = require('ethers');
const p = new JsonRpcProvider('https://polygon-rpc.com');
p.getBalance('YOUR_ADDRESS').then(b => console.log('MATIC:', formatUnits(b)));
"
```

---

## Dashboard Access

### Login Credentials

Customers login to the CashClaw dashboard with **email + password**:

1. Go to `https://cashclaw.cc/dashboard` (or `http://localhost:3001` if self-hosting)
2. Click **Register** → enter email + password (min 8 chars)
3. After registration, login with same credentials
4. JWT token stored in browser localStorage (`cc_token`)

### Connect Dashboard to Your Bot

The dashboard on `cashclaw.cc` needs to know where your bot's API is running:

1. Login to dashboard
2. Click **gear icon** (⚙️) in topbar
3. Enter your backend URL:
   - **Local Mac:** `http://localhost:3001`
   - **VPS:** `http://YOUR_VPS_IP:3001`
   - **CF Tunnel:** `https://your-tunnel.trycloudflare.com`
4. Click **Save & Reload**

### Quick Tunnel Setup (expose local bot to internet)

```bash
# Install cloudflared
brew install cloudflare/cloudflare/cloudflared  # Mac
# or: curl -fsSL https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o /usr/local/bin/cloudflared  # Linux

# Create quick tunnel (no account needed)
cloudflared tunnel --url http://localhost:3001
# Output: https://abc123-random.trycloudflare.com
# → Paste this URL into Dashboard Settings
```

### Self-Hosted Dashboard

If you don't want to use `cashclaw.cc`, the bot serves its own dashboard:

```bash
# Dashboard auto-starts with the bot on port 3001
# Access: http://localhost:3001
# No Settings gear needed — same origin, API calls work automatically
```

---

## Security Best Practices

1. **NEVER share your private key** — treat it like a bank password
2. **Store LICENSE_SECRET in env var**, not in code or git
3. **Use --dry-run first** for at least 24 hours before going live
4. **Start with small capital** ($100-200) until you verify the bot works
5. **Monitor daily** — check logs for errors or unexpected behavior
6. **Keep macOS/Ubuntu updated** for security patches
7. **Use firewall** — only expose ports you need (SSH 22, optionally LLM port)
8. **VPS firewall**: `ufw allow 22 && ufw enable` (don't expose LLM port publicly)

---

## Cost Summary

### Option A: Apple Silicon (One-time)

| Item | Cost |
|------|------|
| M1 Max 64GB Mac Studio (refurbished) | $1,800-2,400 |
| M2 Pro 64GB Mac Mini (refurbished) | $1,400-1,800 |
| Electricity (~15W idle) | ~$5/month |
| Internet | Existing connection |
| **Total first year** | **$1,460-2,460** |

### Option B: Cloud VPS (Monthly)

| Item | Cost/month |
|------|------------|
| GPU VPS (RunPod RTX 4090) | $150-200 |
| Or CPU-only (Hetzner 128GB) | $100 |
| **Total first year** | **$1,200-2,400** |

### Breakeven

Apple Silicon pays for itself in **6-12 months** vs cloud GPU. After that, inference is essentially free forever.
