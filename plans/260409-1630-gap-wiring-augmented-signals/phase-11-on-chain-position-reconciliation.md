# Phase 11: On-Chain Position Reconciliation

## Overview
- **Priority**: P1
- **Status**: pending

Sync local position cache with actual on-chain state. PDF Section 3.5.

## Related Code Files
### Create
- `src/execution/on-chain-position-reconciler.ts` — periodically query Polygon CTF contract for actual positions, compare with local cache, alert on discrepancy

## Implementation Steps
1. Read existing `src/risk/position-manager.ts` for local position state
2. Create reconciler: query Polymarket CTF contract via ethers.js for wallet balances
3. Compare on-chain vs local positions every 60s
4. If discrepancy > threshold → alert via NATS `risk.alert` + Telegram
5. Option to auto-correct local cache from on-chain truth

## Success Criteria
- Detects position mismatch within 60s
- Alerts on discrepancy > $5 value
- Auto-corrects local state from blockchain
