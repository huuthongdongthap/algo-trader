/**
 * SDK public types for algo-trade API consumers.
 * Mirrors server response shapes from src/api/routes.ts.
 */

// ─── Core domain types (re-used in responses) ────────────────────────────────

export type OrderSide = 'buy' | 'sell';
export type StrategyName =
  | 'cross-market-arb'
  | 'market-maker'
  | 'grid-trading'
  | 'dca-bot'
  | 'funding-rate-arb';

/** Single trade result as returned in trade log */
export interface TradeResult {
  orderId: string;
  marketId: string;
  side: OrderSide;
  fillPrice: string;
  fillSize: string;
  fees: string;
  timestamp: number;
  strategy: StrategyName;
}

// ─── Response types ───────────────────────────────────────────────────────────

/** GET /api/health */
export interface HealthResponse {
  status: 'ok' | 'degraded' | 'down';
  timestamp: number;
  uptime: number;
}

/** GET /api/status */
export interface StatusResponse {
  running: boolean;
  strategies: string[];
  tradeCount: number;
  config: Record<string, unknown>;
  uptime: number;
}

/** GET /api/trades */
export interface TradeListResponse {
  trades: TradeResult[];
  count: number;
}

/** GET /api/pnl */
export interface PnlResponse {
  totalFees: string;
  tradeCount: number;
  tradesByStrategy: Record<string, number>;
}

// ─── Request / action types ───────────────────────────────────────────────────

/** POST /api/strategy/start | /api/strategy/stop */
export interface StrategyActionRequest {
  name: StrategyName;
}

/** Response from strategy start/stop */
export interface StrategyActionResponse {
  ok: boolean;
  strategy: string;
  action: 'started' | 'stopped';
}

// ─── Marketplace / backtest stubs (future endpoints) ─────────────────────────

/** Stub: future marketplace listing response */
export interface MarketplaceListResponse {
  items: Array<{ id: string; name: string; description: string }>;
}

/** Stub: future backtest request */
export interface BacktestRequest {
  strategy: StrategyName;
  from: number;
  to: number;
  initialCapital: number;
}

/** Stub: future backtest response */
export interface BacktestResponse {
  totalReturn: number;
  sharpeRatio: number;
  maxDrawdown: number;
  trades: TradeResult[];
}
