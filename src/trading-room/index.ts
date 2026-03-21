// Trading Room barrel export
// Re-exports all trading-room modules for clean external imports.
// NOTE: Some files (agi-orchestrator, signal-pipeline, command-registry, room-commands,
//       stealth-executor, market-regime-detector, fee-aware-spread, telegram-controller,
//       telegram-commands) are created by parallel agents — import paths are correct
//       and will resolve once those files exist.

// ─── Core infrastructure ─────────────────────────────────────────────────────
export * from './command-parser.js';
export * from './exchange-registry.js';

// ─── Wiring / orchestration ──────────────────────────────────────────────────
export * from './room-wiring.js';

// ─── Parallel-agent files (will exist after parallel phase completes) ─────────
export * from './command-registry.js';
export * from './room-commands.js';
export * from './agi-orchestrator.js';
export * from './signal-pipeline.js';
export * from './stealth-executor.js';
export * from './market-regime-detector.js';
export * from './fee-aware-spread.js';
export * from './telegram-controller.js';
export * from './telegram-commands.js';
