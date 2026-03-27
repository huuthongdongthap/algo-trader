# Cloud Infrastructure

## Providers Overview

| Provider              | Services Used                          | Cost (monthly) | Tier     |
| --------------------- | -------------------------------------- | -------------- | -------- |
| Cloudflare Pages      | Frontend hosting (cashclaw.cc)         | $0             | Free     |
| Cloudflare Workers    | Edge API / middleware                  | $0             | Free     |
| Cloudflare Tunnel     | Expose M1 Max services to internet     | $0             | Free     |
| Cloudflare D1         | SQLite DB at edge                      | $0             | Free     |
| Cloudflare KV         | Session/config key-value store         | $0             | Free     |
| GitHub                | Source control, CI/CD (Actions)        | $0             | Free     |
| M1 Max (local)        | Primary compute: API, workers, LLM     | ~$0 (owned)    | On-prem  |

**Estimated total cloud spend: ~$0/month** (all free tiers + owned hardware)

## Single Points of Failure (SPOF)

- **M1 Max** is the primary SPOF: all backend workloads run locally
  - No automatic failover if machine restarts, loses power, or network drops
  - Cloudflare Tunnel goes down if M1 Max is offline
- **Cloudflare free tier limits**: 100k Workers requests/day, 5M KV reads/day
  - Exceeding limits → 429 errors without warning

## Failover Considerations

| Risk                      | Impact   | Mitigation                                     |
| ------------------------- | -------- | ---------------------------------------------- |
| M1 Max offline            | High     | Static fallback page on Cloudflare Pages       |
| Cloudflare outage         | Medium   | Rare; no mitigation currently planned          |
| D1 quota exceeded         | Medium   | Add Postgres fallback (pg dependency present)  |
| GitHub Actions quota      | Low      | 2000 min/month on free; monitor usage          |

## Monitoring

- Uptime checks: `scripts/uptime-check.sh` (run via cron every 5 min)
- Logs: `/tmp/cashclaw-uptime.log`
- Error tracking: **Sentry not yet installed** — recommended to add `@sentry/node`

## Backup

- Code: GitHub (`longtho638-jpg/algo-trader`) — full history
- DB: `scripts/backup-db.sh` handles local D1/Postgres snapshots
- No off-site backup configured yet — risk: M1 Max disk failure = data loss
