// System event type definitions for algo-trade platform
// Provides a typed map for all pub/sub events across the system
import type { TradeResult, PnlSnapshot } from '../core/types.js';

/**
 * Typed map of all system events.
 * Key = event name, Value = event payload shape.
 */
export interface SystemEventMap {
  /** Fired when a trade order has been fully filled */
  'trade.executed': { trade: TradeResult };

  /** Fired when a trade order fails to submit or fill */
  'trade.failed': { error: string; request: unknown };

  /** Fired when a strategy begins its run loop */
  'strategy.started': { name: string; config: unknown };

  /** Fired when a strategy is intentionally stopped */
  'strategy.stopped': { name: string; reason: string };

  /** Fired when a strategy encounters an unrecoverable error */
  'strategy.error': { name: string; error: string };

  /** Fired after a new user account is created */
  'user.registered': { userId: string; email: string };

  /** Fired after a user upgrades or activates a subscription tier */
  'user.subscribed': { userId: string; tier: string };

  /** Fired when an alert rule threshold is crossed */
  'alert.triggered': { rule: string; message: string };

  /** Fired once on application startup */
  'system.startup': { version: string; timestamp: number };

  /** Fired once on graceful application shutdown */
  'system.shutdown': { reason: string };

  /** Fired periodically with portfolio PnL metrics */
  'pnl.snapshot': { snapshot: PnlSnapshot };
}

/** Union of all valid system event names */
export type SystemEventName = keyof SystemEventMap;

/** Generic handler type for a specific event */
export type SystemEventHandler<K extends SystemEventName> = (
  data: SystemEventMap[K],
) => void;
