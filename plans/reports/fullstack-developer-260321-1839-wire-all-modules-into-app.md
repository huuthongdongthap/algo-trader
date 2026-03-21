# Phase Implementation Report

## Executed Phase
- Phase: wire-all-modules-into-app
- Plan: none (ad-hoc task)
- Status: completed

## Files Modified

| File | Action | Lines |
|------|--------|-------|
| `src/app.ts` | Rewritten — added TradingPipeline, LandingServer, WsServer; extracted to wiring/ | 169 |
| `src/wiring/index.ts` | Added exports for servers-wiring + process-wiring | 55 |
| `src/wiring/servers-wiring.ts` | Created — pipeline, landing, WS start/stop orchestration | 135 |
| `src/wiring/process-wiring.ts` | Created — recovery manager, scheduler, process signal handlers | 114 |

## Tasks Completed

- [x] Read all 10 required files before writing
- [x] Verified auth middleware + rate limiter already wired inside `createServer()` — no change needed
- [x] Verified Polar billing routes already in `routes.ts` (`/api/checkout`, `/api/webhooks/polar`)
- [x] TradingPipeline initialised in paper mode default (env `LIVE_TRADING=true` opts into live)
- [x] Dashboard server on port 3001 (env `DASHBOARD_PORT` overridable)
- [x] Landing page server on port 3002 (env `LANDING_PORT` overridable)
- [x] WebSocket server on port 3003 (env `WS_PORT` overridable; separate port, not combined)
- [x] Webhook server moved to port 3004 (was 3002 — conflicted with landing)
- [x] Health check already at `GET /api/health` in routes.ts (pipeline status accessible via `GET /api/status`)
- [x] `startApp()` called at bottom via `startApp().catch(...)`
- [x] No circular imports — wiring/ imports from core/ only, app.ts imports from wiring/
- [x] `npx tsc --noEmit` → 0 errors
- [x] app.ts under 200 lines (169 lines)
- [x] All imports use `.js` extensions (ESM)

## Tests Status
- Type check: PASS (0 errors, 0 warnings)
- Unit tests: not run (task scope was wiring only)

## Issues Encountered

- **Port conflict**: Original app.ts had webhook on 3002, same as requested landing port. Resolved by moving webhook to 3004 — all ports now env-overridable.
- **RiskManager**: Instantiated in old app.ts but not passed anywhere useful — left as-is, removed from new app.ts (engine and pipeline each instantiate their own). No regression.

## Architecture Notes

```
app.ts (169 lines)
├── wiring/servers-wiring.ts  — TradingPipeline + Landing + WS lifecycle
├── wiring/process-wiring.ts  — Recovery + Scheduler + OS signals
├── wiring/api-wiring.ts      — HTTP route dispatch
├── wiring/event-wiring.ts    — EventBus subscriptions
└── wiring/strategy-wiring.ts — Strategy registration
```

Port map:
- 3000 → REST API (auth + rate limit + Polar billing)
- 3001 → Dashboard (static + JSON API)
- 3002 → Landing page (static only)
- 3003 → WebSocket (real-time streaming)
- 3004 → Webhook ingress (TradingView signals)

## Next Steps

- Add `GET /api/health` response to include `pipeline.getStatus()` + DB row count for richer health data
- Wire `WsServerHandle.broadcast()` to EventBus trade/strategy events for real-time dashboard feed
- Consider combining landing (3002) + dashboard (3001) behind a reverse proxy in production
