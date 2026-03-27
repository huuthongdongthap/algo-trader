# SAU KHI DRY_RUN PASS — Go Live Checklist

## Bước 1: Tạo credentials thật

### Polymarket wallet
```bash
# Cách 1: Dùng wallet có sẵn (MetaMask, etc.) — export private key
# Cách 2: Tạo wallet mới
node -e "const {Wallet}=require('ethers'); const w=Wallet.createRandom(); console.log('Address:',w.address); console.log('Key:',w.privateKey)"

# Deposit USDC.e vào wallet trên Polygon network
# Minimum: $100 cho testing
# Bridge từ Ethereum: bridge.polymarket.com
```

### Polymarket API key (tự động)
```bash
# Bot tự derive khi chạy lần đầu với PRIVATE_KEY
# Chỉ cần set PRIVATE_KEY trong .env, bỏ trống API_KEY/SECRET/PASSPHRASE
# Bot sẽ log ra 3 giá trị → copy vào .env để reuse
```

### Kalshi API key
```
1. Login kalshi.com
2. Account Settings → API Keys
3. Generate RSA key pair → download .pem file
4. Copy key_id UUID
5. Save .pem file vào repo root: ./kalshi-private-key.pem
6. Update .env:
   KALSHI_API_KEY_ID=your-uuid
   KALSHI_PRIVATE_KEY_PATH=./kalshi-private-key.pem
```

### Binance API key
```
1. Login binance.com
2. API Management → Create API
3. Permissions: READ ONLY (không cần trade)
4. Save API key + secret vào .env:
   BINANCE_API_KEY=xxx
   BINANCE_API_SECRET=xxx
```

## Bước 2: Update .env cho live

```env
DRY_RUN=false
PRIVATE_KEY=0x_real_key_here
MAX_BANKROLL=100          # Start nhỏ: $100
MAX_POSITION_PCT=0.10     # Max 10% per trade = $10
MIN_ARB_EDGE=0.03         # 3% minimum edge
MM_SPREAD=0.10            # 10¢ spread (conservative)
MM_SIZE=20                # 20 shares per side
```

## Bước 3: Chạy live

```bash
# Local
npm run polymarket

# Hoặc Docker trên VPS
docker-compose up -d
docker logs -f algo-trader
```

## Bước 4: Monitor (ngày đầu)

```
Watch for:
✅ "[BinanceWS] CMS WebSocket connected" — listing detection online
✅ "[Scan] N markets" — market discovery working
✅ "[MM] question... BID:X ASK:Y" — market maker quoting
✅ "[CrossArb] Kalshi balance: $X" — Kalshi connected
✅ "[FILL] BUY/SELL size@price CONFIRMED" — trades executing

Red flags:
❌ "401" errors — API key expired or wrong
❌ "422" errors — postOnly crossing spread (normal occasionally, bad if constant)
❌ "429" errors — rate limited (reduce loop frequency)
❌ "Kalshi auth failed" — RSA key issue
❌ Crash + no auto-restart — check PM2 logs
```

## Bước 5: Scale (tuần 2+)

```
Tuần 1: $100, observe
Tuần 2: $500 nếu profitable
Tuần 3: $1000-2000
Tuần 4: $5000 target

Điều chỉnh:
- MM_SPREAD: 0.10 → 0.08 → 0.06 (tighter = more fills but more risk)
- MM_SIZE: 20 → 50 → 100 (larger = more profit per fill)
- MIN_ARB_EDGE: 0.03 → 0.02 (lower = more opportunities but thinner margin)
- Thêm MARKET_PAIRS cho CrossPlatformArb
```
