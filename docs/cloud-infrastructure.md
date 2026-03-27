# Cloud Infrastructure

## Providers Overview

| Provider           | Services Used                      | Cost/month  | Free Tier Limits              | Tier    |
| ------------------ | ---------------------------------- | ----------- | ----------------------------- | ------- |
| Cloudflare Pages   | Frontend hosting                   | $0          | Unlimited requests            | Free    |
| Cloudflare Workers | Edge API / middleware              | $0          | 100k req/day, 10ms CPU/req    | Free    |
| Cloudflare Tunnel  | Expose M1 Max to internet          | $0          | Unlimited                     | Free    |
| Cloudflare D1      | SQLite DB at edge                  | $0          | 5M reads/day, 100k writes/day | Free    |
| Cloudflare KV      | Session/config key-value store     | $0          | 100k reads/day                | Free    |
| GitHub             | Source control, CI/CD Actions      | $0          | 2000 min/month                | Free    |
| M1 Max (local)     | Primary compute: API, workers, LLM | ~$0 (owned) | N/A                           | On-prem |

**Estimated total cloud spend: ~$0/month**

## Scaling Plan (When to Upgrade)

| Trigger                          | Action                                     | Cost impact       |
| -------------------------------- | ------------------------------------------ | ----------------- |
| Workers > 80k req/day            | Upgrade to CF Workers Paid ($5/mo)         | +$5/mo            |
| D1 reads > 4M/day                | Migrate to Postgres (already on M1 Max)    | $0 (on-prem)      |
| GitHub Actions > 1800 min/month  | Add self-hosted runner on M1 Max           | $0 (on-prem)      |
| M1 Max uptime < 99%              | Add VPS failover (Fly.io $5/mo)            | +$5/mo            |

## Failover Procedures

| Risk                  | Impact | Procedure                                                        |
| --------------------- | ------ | ---------------------------------------------------------------- |
| M1 Max offline        | High   | 1) CF Tunnel auto-detects down 2) CF Pages serves static fallback 3) SSH + `pm2 restart all` to recover |
| CF Workers 429 error  | Medium | 1) Check `cloudflare.com/analytics` quota 2) Enable Workers Paid if > 100k/day |
| D1 quota exceeded     | Medium | 1) Switch `DATABASE_URL` to local Postgres 2) `pm2 restart app` |
| GitHub Actions quota  | Low    | 1) Enable self-hosted runner: `scripts/setup-gh-runner.sh`       |
| CF Tunnel reconnect   | Medium | `ssh macbook@192.168.11.111 'cloudflared tunnel run algo-trader'` |

## Multi-Region Strategy

Current: Single-region (M1 Max on-prem). Progression path:
1. **Now (Phase 1)**: M1 Max + Cloudflare edge caching — serves static assets globally
2. **Phase 2 (~$10/mo)**: Add Fly.io VPS as hot standby; replicate DB via pg_dump cron
3. **Phase 3 (~$30/mo)**: Cloudflare Workers for API layer; M1 Max as primary DB node

## Budget Alerts

Set Cloudflare notification at 80% of free tier limits:
- Workers: alert at 80k req/day → `cloudflare.com → Notifications → Usage Alerts`
- D1 reads: alert at 4M/day
- KV reads: alert at 80k/day
- GitHub Actions: monitor at 1600 min/month via `gh run list`

## Monitoring

- Uptime checks: `scripts/uptime-check.sh` (cron every 5 min)
- Logs: `/tmp/cashclaw-uptime.log`
- Error tracking: Sentry recommended — add `@sentry/node` + `SENTRY_DSN` env var

## Backup

- Code: GitHub (`longtho638-jpg/algo-trader`) — full history, branch protection on main
- DB: `scripts/backup-db.sh` — local D1/Postgres snapshots
- Off-site: configure `scripts/backup-db.sh` to push to Cloudflare R2 (free 10GB/mo)
