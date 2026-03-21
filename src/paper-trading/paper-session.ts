// Paper trading session lifecycle: wraps PaperExchange + PaperPortfolio
// Tracks session state, trade history, and generates summary reports

import type { TradeResult } from '../core/types.js';
import type { TradeRequest } from '../engine/trade-executor.js';
import { logger } from '../core/logger.js';
import { PaperExchange } from './paper-exchange.js';
import { PaperPortfolio } from './paper-portfolio.js';

export interface SessionSummary {
  sessionId: string;
  startedAt: number;
  stoppedAt: number | null;
  durationMs: number;
  initialCapital: number;
  finalEquityUsdc: number;
  totalPnl: number;
  totalPnlPercent: number;
  tradeCount: number;
  winCount: number;
  lossCount: number;
  winRate: number;
  trades: TradeResult[];
}

/**
 * PaperSession: single end-to-end paper trading session.
 * Lifecycle: start() → executeTrade() × N → stop() → getSessionSummary()
 */
export class PaperSession {
  readonly sessionId: string;
  private exchange: PaperExchange;
  private portfolio: PaperPortfolio;
  private trades: TradeResult[] = [];
  private active: boolean = false;
  private startedAt: number = 0;
  private stoppedAt: number | null = null;
  private initialCapital: number = 0;
  /** Track per-trade P&L for win/loss counting */
  private tradePnls: number[] = [];

  constructor(sessionId?: string) {
    this.sessionId = sessionId ?? `ps_${Date.now().toString(36)}`;
    this.exchange = new PaperExchange();
    this.portfolio = new PaperPortfolio(1); // temp; overridden in start()
  }

  // ─── Lifecycle ───────────────────────────────────────────────────────────────

  start(initialCapital: number): void {
    if (this.active) throw new Error(`Session ${this.sessionId} already active`);
    if (initialCapital <= 0) throw new Error('initialCapital must be positive');

    this.initialCapital = initialCapital;
    this.exchange = new PaperExchange();
    this.portfolio = new PaperPortfolio(initialCapital);
    this.trades = [];
    this.tradePnls = [];
    this.startedAt = Date.now();
    this.stoppedAt = null;
    this.active = true;

    logger.info(
      `[PaperSession] Started ${this.sessionId} with capital $${initialCapital}`,
      'PaperSession',
    );
  }

  stop(): SessionSummary {
    if (!this.active) throw new Error(`Session ${this.sessionId} is not active`);
    this.stoppedAt = Date.now();
    this.active = false;

    const summary = this.getSessionSummary();
    logger.info(
      `[PaperSession] Stopped ${this.sessionId} — P&L: $${summary.totalPnl.toFixed(2)} (${summary.totalPnlPercent.toFixed(2)}%) | ${summary.tradeCount} trades | win rate ${(summary.winRate * 100).toFixed(1)}%`,
      'PaperSession',
    );
    return summary;
  }

  reset(): void {
    this.active = false;
    this.stoppedAt = null;
    this.startedAt = 0;
    this.trades = [];
    this.tradePnls = [];
    this.exchange = new PaperExchange();
    // Keep initialCapital so caller can call start() again with same config
    this.portfolio = new PaperPortfolio(this.initialCapital > 0 ? this.initialCapital : 1);
    logger.info(`[PaperSession] Reset ${this.sessionId}`, 'PaperSession');
  }

  isActive(): boolean {
    return this.active;
  }

  // ─── Trade execution ─────────────────────────────────────────────────────────

  /**
   * Route a trade request through PaperExchange and apply result to portfolio.
   * Must call start() before executing trades.
   */
  executeTrade(request: TradeRequest): TradeResult {
    if (!this.active) throw new Error(`Session ${this.sessionId} is not active — call start() first`);

    const result = this.exchange.submitOrder(request);

    // Only apply to portfolio if actually filled (fillPrice > 0)
    const fillPrice = parseFloat(result.fillPrice);
    if (fillPrice > 0) {
      const prevPnl = this.portfolio.getRealizedPnl();
      this.portfolio.applyTrade(result);
      const deltaPnl = this.portfolio.getRealizedPnl() - prevPnl;
      // For buy trades, delta will be 0 (cost basis, not realized); track on sells
      if (request.side === 'sell') {
        this.tradePnls.push(deltaPnl);
      }
    }

    this.trades.push(result);
    return result;
  }

  // ─── Price feed passthrough ──────────────────────────────────────────────────

  /** Feed real market price into the simulated exchange */
  setPrice(symbol: string, price: number): void {
    this.exchange.setPrice(symbol, price);
  }

  // ─── Summary & export ────────────────────────────────────────────────────────

  getSessionSummary(): SessionSummary {
    const now = this.stoppedAt ?? Date.now();
    const durationMs = this.startedAt > 0 ? now - this.startedAt : 0;

    // Build current price map from exchange for equity calculation
    const priceMap: Record<string, number> = {};
    for (const trade of this.trades) {
      const base = trade.marketId.split('-')[0] ?? trade.marketId;
      if (!priceMap[base]) {
        priceMap[base] = parseFloat(trade.fillPrice);
      }
    }

    const finalEquityUsdc = this.portfolio.getEquity(priceMap);
    const totalPnl = finalEquityUsdc - this.initialCapital;
    const totalPnlPercent = this.initialCapital > 0 ? (totalPnl / this.initialCapital) * 100 : 0;

    const winCount = this.tradePnls.filter(p => p > 0).length;
    const lossCount = this.tradePnls.filter(p => p <= 0).length;
    const winRate = this.tradePnls.length > 0 ? winCount / this.tradePnls.length : 0;

    return {
      sessionId: this.sessionId,
      startedAt: this.startedAt,
      stoppedAt: this.stoppedAt,
      durationMs,
      initialCapital: this.initialCapital,
      finalEquityUsdc,
      totalPnl,
      totalPnlPercent,
      tradeCount: this.trades.length,
      winCount,
      lossCount,
      winRate,
      trades: [...this.trades],
    };
  }

  exportJson(): string {
    return JSON.stringify(this.getSessionSummary(), null, 2);
  }
}
