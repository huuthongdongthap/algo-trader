# Docker Desktop Safety — CashClaw Trading Bot

## CRITICAL: Disable Auto-Update

Docker Desktop auto-updates restart the Docker engine, killing ALL running containers.
CashClaw has open GTC orders on Polymarket — a surprise restart means stale orders
fill at adverse prices.

### Step 1: Disable auto-update

Docker Desktop > Settings > Software Updates > UNCHECK "Automatically check for updates"

### Step 2: Pin version

Do NOT upgrade Docker Desktop unless you:
1. Stop CashClaw: `docker compose -f docker/docker-compose.cashclaw.yaml down`
2. Verify all orders cancelled (check Polymarket UI)
3. Upgrade Docker Desktop
4. Restart: `docker compose -f docker/docker-compose.cashclaw.yaml up -d`

### Step 3: Alternative — use Colima

Colima is a lightweight Docker runtime without auto-update risk:

```bash
brew install colima docker
colima start --cpu 4 --memory 4 --disk 60
# Then use docker compose as normal
```

## Coexistence with Mekong CLI

This M1 Max runs TWO containers sharing the same Docker engine:

| Container | Name | Ports | LLM Usage |
|-----------|------|-------|-----------|
| CashClaw | `cashclaw-bot` | None (outbound only) | DeepSeek :11435, Nemotron :11436 |
| Mekong CLI | `mekong-dev` | :3001, :8000 | DeepSeek :11435, Nemotron :11436 |

Both share the same bare-metal LLM servers:
- **Nemotron** (:11436) — fast (<1s), rare overlap
- **DeepSeek** (:11435) — serializes requests. If Mekong PEV is planning, CashClaw waits. 90s timeout handles this

A Docker restart kills BOTH. Always stop CashClaw gracefully first.

## Memory Budget

```
MLX LLM servers:  ~6 GB (bare metal)
Docker VM:        ~4 GB
macOS:            ~8 GB
────────────────────────
Total:           ~18 GB / 64 GB — no pressure
```

## Recovery After Unexpected Restart

CashClaw's crash recovery auto-cancels all open orders on startup via `cancelAllOpen()`.
But during the gap between crash and restart, orders may have filled at adverse prices.

After any unexpected restart:
1. Check `docker logs cashclaw-bot` for recovery summary
2. Verify Polymarket positions manually
3. Review `data/algo-trade.db` trade log for unexpected fills

## Graceful Shutdown

CashClaw handles SIGTERM (sent by `docker stop`):
1. `stop_grace_period: 30s` gives the bot time
2. SIGTERM handler stops strategies
3. `cancelAllOpen()` cancels every GTC order
4. Process exits cleanly

If orders are still open after 30s, Docker sends SIGKILL. This is the dangerous case —
set `CASHCLAW_MAX_POSITION=50` to limit exposure.
