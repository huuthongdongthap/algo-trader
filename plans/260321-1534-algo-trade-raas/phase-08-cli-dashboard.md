---
phase: 8
title: "CLI & Dashboard"
status: completed
priority: P2
effort: 4h
parallel_group: B
blocks: [9]
blocked_by: [1]
---

# Phase 8: CLI & Dashboard

## Context
- [Plan Overview](./plan.md)
- [Phase 1: Core](./phase-01-core-infrastructure.md)

## Overview
CLI interface for bot control and monitoring. Commander.js for commands, terminal dashboard for live P&L/position tracking.

## File Ownership (Exclusive)
```
src/cli/index.ts              # CLI entry point, commander setup
src/cli/commands/start.ts     # Start strategies
src/cli/commands/stop.ts      # Stop strategies
src/cli/commands/status.ts    # Show current status/positions
src/cli/commands/backtest.ts  # Run strategy backtests
src/cli/commands/config.ts    # View/edit config
src/cli/dashboard.ts          # Live terminal dashboard
src/cli/index.ts              # Barrel + main entry
```

## Requirements

### Functional
1. **CLI commands** (~80 lines each):
   - `algo start [strategy]` - start one or all strategies
   - `algo stop [strategy]` - gracefully stop (cancel orders first)
   - `algo status` - show running strategies, positions, P&L
   - `algo backtest [strategy] --from --to` - historical backtest
   - `algo config [key] [value]` - view/set config values
2. **dashboard.ts** (~150 lines): Live terminal UI
   - Real-time P&L per strategy
   - Open positions table
   - Recent trades list
   - System health (API connections, latency)
   - Auto-refresh every 5 seconds

### Non-Functional
- Colored output for gains (green) / losses (red)
- Clean exit on Ctrl+C (SIGINT handler → stop all strategies)
- Help text for all commands

## Implementation Steps

1. Create `src/cli/index.ts`:
   - Commander.js program setup
   - Register all commands
   - Global options: --verbose, --config-file
2. Create command files:
   - `start.ts`: Load config, initialize clients, start strategy loops
   - `stop.ts`: Signal strategies to stop, wait for order cancellations
   - `status.ts`: Query database for positions/P&L, format table output
   - `backtest.ts`: Load historical data, run strategy in simulation mode
   - `config.ts`: Read/write .env or config JSON
3. Create `src/cli/dashboard.ts`:
   - Terminal table rendering (console.table or custom formatting)
   - Clear screen + redraw on interval
   - ANSI colors for visual feedback

## Todo
- [x] src/cli/index.ts (commander setup)
- [x] src/cli/commands/start.ts
- [ ] src/cli/commands/stop.ts (deferred to integration phase)
- [x] src/cli/commands/status.ts
- [x] src/cli/commands/backtest.ts
- [x] src/cli/commands/config-cmd.ts (renamed to avoid collision with core/config.ts)
- [x] src/cli/dashboard.ts (text-based terminal UI with ANSI colors)
- [x] Verify: `npx tsc --noEmit` passes with 0 errors

## Success Criteria
- All CLI commands parse arguments correctly
- `algo start` initializes and runs strategies
- `algo status` displays formatted positions/P&L
- Dashboard refreshes with live data
- Clean shutdown on Ctrl+C

## Risk Assessment
- **Low risk**: CLI is standard tooling, no external dependencies
- **Note**: Dashboard complexity can be deferred; start with simple console.table
