# Deployment

## Prerequisites

- Node.js 20+
- pnpm (workspace manager)
- Valid exchange API keys for live trading

## Environment Setup

```sh
cp .env.example .env
# Edit .env — set EXCHANGE_API_KEY, EXCHANGE_SECRET at minimum for live trading
# Arb commands require per-exchange keys: BINANCE_API_KEY, OKX_API_KEY, BYBIT_API_KEY, etc.
```

Live trading validates keys on startup and exits if keys are missing, empty, or still set to placeholder values.

Backtest and arb:scan (dry-run) do not require API keys.

## Build

From the monorepo root (required — workspace packages must be built first):

```sh
pnpm install --frozen-lockfile
pnpm --filter algo-trader build
```

Or from the app directory:

```sh
npm run build        # tsc → dist/
npm run typecheck    # type check only, no emit
```

Output: `dist/index.js`

## Running

```sh
# Development (ts-node, no build needed)
npm run dev -- backtest -s RsiSma -d 30

# Production (compiled)
node dist/index.js live -s BTC/USDT -e binance
node dist/index.js backtest -s RsiSma -d 30 -b 10000
```

## PM2 Deployment

`ecosystem.config.js` configures the process manager:

```sh
pm2 start ecosystem.config.js       # Start
pm2 restart algo-trader             # Restart
pm2 stop algo-trader                # Stop
pm2 logs algo-trader                # Tail logs
pm2 save                            # Persist across reboots
pm2 startup                         # Generate startup hook
```

Config summary:
- 1 instance, fork mode
- Max memory restart: 512 MB
- Restart delay: 5s, max 10 restarts
- Logs: `logs/algo-trader-out.log`, `logs/algo-trader-error.log`

## Docker Deployment

Multi-stage build (builder + runner). Runner uses non-root user `trader`.

```sh
# Build (run from monorepo root — Dockerfile requires workspace packages)
docker build -f apps/algo-trader/Dockerfile -t algo-trader:latest .

# Run backtest (no keys needed)
docker run --rm algo-trader:latest node dist/index.js backtest -s RsiSma -d 30

# Run live trading
docker run -d \
  --name algo-trader \
  --env-file apps/algo-trader/.env \
  --restart unless-stopped \
  -v $(pwd)/apps/algo-trader/logs:/app/logs \
  algo-trader:latest \
  node dist/index.js live -s BTC/USDT -e binance
```

Healthcheck: `GET http://localhost:3000/health` — interval 30s, timeout 5s, 3 retries.

## Health Monitoring

The `HealthManager` runs an internal check every 5 seconds (configurable). It publishes `RISK_EVENT` signals to `SignalMesh` when metrics cross thresholds:

- `ok` — below 80% of threshold
- `warning` — 80–100% of threshold
- `critical` — at or above threshold

Logs are written via Winston to `./logs/` (path set in `config/default.yaml`).

To check process health externally:

```sh
pm2 show algo-trader          # Process status, memory, restarts
tail -f logs/algo-trader-out.log
tail -f logs/algo-trader-error.log
```

## Graceful Shutdown

`SIGINT` / `SIGTERM` triggers `engine.stop()`:

1. `dataProvider.stop()` — stops candle feed
2. `healthManager.stopMonitoring()` — stops health check interval
3. `strategy.onFinish()` — strategy cleanup
4. `pluginManager.onStop()` + `onFinish()` — plugin teardown

PM2 and Docker stop commands both send `SIGTERM`, so shutdown is clean.

## Troubleshooting

| Issue | Fix |
|-------|-----|
| `STRICT VALIDATION FAILED: Exchange API Key` | Set real keys in `.env`; placeholder values are rejected |
| `Live bot failed: ...` with no key error | Check `EXCHANGE_API_KEY` length >= 10 chars |
| Build fails with missing workspace package | Run `pnpm install` from monorepo root before building |
| `Cannot find module '@agencyos/trading-core'` | Workspace packages not installed — run `pnpm install --filter algo-trader...` from root |
| PM2 process keeps restarting | Check `logs/algo-trader-error.log`; likely bad .env config |
| Arb commands fail with auth error | Set per-exchange keys (`BINANCE_API_KEY`, `OKX_API_KEY`, etc.) in `.env` |
| High memory usage | PM2 restarts at 512 MB; reduce `TickStore` size (default 10k ticks) if needed |
