/**
 * API Type Definitions for Algo-Trader Dashboard
 * Matches backend responses from /api/signals, /api/pnl, /api/admin, /api/health
 */

// === Signals API ===
export interface Signal {
  id: string;
  symbol: string;
  buyExchange: string;
  sellExchange: string;
  buyPrice: number;
  sellPrice: number;
  spread: number; // spreadPercent
  latency: number;
  timestamp: number;
}

export interface SignalsResponse {
  data: Signal[];
  count: number;
  limit: number;
}

// === P&L API ===
export interface PnLHistoryPoint {
  pnl: number;
  trades?: number;
  label?: string;
  date?: string;
}

export interface PerformanceMetrics {
  totalPnl: number;
  dailyPnl: number;
  weeklyPnl: number;
  monthlyPnl: number;
  sharpeRatio: number;
  maxDrawdown: number;
  winRate: number;
  avgTrade: number;
  bestTrade: number;
  worstTrade: number;
  /** Time-series history for chart rendering. Optional — omitted when no data. */
  pnlHistory?: PnLHistoryPoint[];
}

export interface PnLSummary {
  date: string;
  totalProfit: number;
  totalLoss: number;
  netPnl: number;
  tradeCount: number;
  winCount: number;
  lossCount: number;
  winRate: number;
  avgWin: number;
  avgLoss: number;
  profitFactor: number;
}

export interface DailyPnLData {
  date: string;
  netPnl: number;
  tradeCount: number;
  winRate: number;
}

// === Admin API ===
export interface CircuitBreakerStatus {
  state: 'OPEN' | 'CLOSED' | 'HALF_OPEN';
  reason?: string;
  trippedAt?: number;
}

export interface DrawdownMetrics {
  isHalted: boolean;
  currentDrawdown: number;
  maxDrawdown: number;
  peakEquity: number;
  currentEquity: number;
}

export interface AdminStatus {
  trading: boolean;
  circuitBreaker: CircuitBreakerStatus;
  drawdown: DrawdownMetrics;
  timestamp: number;
}

export interface HaltRequest {
  reason: string;
}

export interface AdminMessage {
  success: boolean;
  message: string;
}

// === Health API ===
export interface HealthStatus {
  status: 'healthy' | 'unhealthy';
  redis: 'ok' | 'error';
  postgres: 'ok' | 'error' | 'disconnected';
  timestamp: number;
  uptime: number;
}

export interface MetricsStatus {
  redis: {
    memoryBytes: number;
    memoryMB: string;
  };
  keys: {
    arbitrage: number;
    positions: number;
    signals: number;
  };
  process: {
    memoryMB: string;
    uptime: number;
  };
  timestamp: number;
}

// === Error Types ===
export interface ApiError {
  error: string;
  status?: number;
}

// === Time Range Types ===
export type TimeRange = 'day' | 'week' | 'month' | 'all';
