// Aggregate P&L tracking across all strategies with equity curve and drawdown
import type { TradeResult, PnlSnapshot, StrategyName } from '../core/types.js';

export interface StrategyBreakdown {
  name: StrategyName;
  equity: number;
  realizedPnl: number;
  tradeCount: number;
  winCount: number;
  winRate: number;
  /** Average win amount (absolute) */
  avgWin: number;
  /** Average loss amount (absolute) */
  avgLoss: number;
}

export interface PortfolioSummary {
  totalEquity: number;
  totalRealizedPnl: number;
  totalUnrealizedPnl: number;
  peakEquity: number;
  drawdown: number;
  totalTradeCount: number;
  totalWinCount: number;
  winRate: number;
  strategies: StrategyBreakdown[];
  snapshotAt: number;
}

export interface EquityPoint {
  timestamp: number;
  equity: number;
}

interface StrategyLedger {
  equity: number;
  realizedPnl: number;
  tradeCount: number;
  winCount: number;
  totalWinAmount: number;
  totalLossAmount: number;
}

export class PortfolioTracker {
  private ledgers: Map<StrategyName, StrategyLedger> = new Map();
  private equityCurve: EquityPoint[] = [];
  private peakEquity: number = 0;
  private unrealizedPnl: number = 0;
  /** Starting capital per strategy for P&L baseline */
  private initialCapital: Map<StrategyName, number>;

  constructor(initialCapital: Map<StrategyName, number> = new Map()) {
    this.initialCapital = new Map(initialCapital);
    // Pre-seed ledgers for known strategies
    for (const [name, capital] of initialCapital) {
      this.ledgers.set(name, {
        equity: capital,
        realizedPnl: 0,
        tradeCount: 0,
        winCount: 0,
        totalWinAmount: 0,
        totalLossAmount: 0,
      });
    }
    this._recordEquityPoint();
  }

  /** Record a completed trade result and update ledger */
  addTrade(trade: TradeResult): void {
    const ledger = this._getOrCreateLedger(trade.strategy);
    const pnl = _computeTradePnl(trade);

    ledger.realizedPnl += pnl;
    ledger.equity += pnl - parseFloat(trade.fees);
    ledger.tradeCount += 1;

    if (pnl > 0) {
      ledger.winCount += 1;
      ledger.totalWinAmount += pnl;
    } else if (pnl < 0) {
      ledger.totalLossAmount += Math.abs(pnl);
    }

    this._updatePeak();
    this._recordEquityPoint();
  }

  /** Update unrealized P&L (call periodically from position data) */
  setUnrealizedPnl(amount: number): void {
    this.unrealizedPnl = amount;
  }

  /** Aggregate summary across all strategies */
  getPortfolioSummary(): PortfolioSummary {
    let totalEquity = 0;
    let totalRealizedPnl = 0;
    let totalTradeCount = 0;
    let totalWinCount = 0;
    const strategies: StrategyBreakdown[] = [];

    for (const [name, ledger] of this.ledgers) {
      totalEquity += ledger.equity;
      totalRealizedPnl += ledger.realizedPnl;
      totalTradeCount += ledger.tradeCount;
      totalWinCount += ledger.winCount;

      const winRate = ledger.tradeCount > 0 ? ledger.winCount / ledger.tradeCount : 0;
      const avgWin = ledger.winCount > 0 ? ledger.totalWinAmount / ledger.winCount : 0;
      const lossCount = ledger.tradeCount - ledger.winCount;
      const avgLoss = lossCount > 0 ? ledger.totalLossAmount / lossCount : 0;

      strategies.push({
        name,
        equity: parseFloat(ledger.equity.toFixed(2)),
        realizedPnl: parseFloat(ledger.realizedPnl.toFixed(2)),
        tradeCount: ledger.tradeCount,
        winCount: ledger.winCount,
        winRate: parseFloat(winRate.toFixed(4)),
        avgWin: parseFloat(avgWin.toFixed(2)),
        avgLoss: parseFloat(avgLoss.toFixed(2)),
      });
    }

    const drawdown = this.peakEquity > 0
      ? (this.peakEquity - totalEquity) / this.peakEquity
      : 0;

    return {
      totalEquity: parseFloat(totalEquity.toFixed(2)),
      totalRealizedPnl: parseFloat(totalRealizedPnl.toFixed(2)),
      totalUnrealizedPnl: parseFloat(this.unrealizedPnl.toFixed(2)),
      peakEquity: parseFloat(this.peakEquity.toFixed(2)),
      drawdown: parseFloat(Math.max(0, drawdown).toFixed(4)),
      totalTradeCount,
      totalWinCount,
      winRate: totalTradeCount > 0
        ? parseFloat((totalWinCount / totalTradeCount).toFixed(4))
        : 0,
      strategies,
      snapshotAt: Date.now(),
    };
  }

  /** Return equity curve for charting */
  getEquityCurve(): EquityPoint[] {
    return [...this.equityCurve];
  }

  /** Export full tracker state as JSON string */
  toJSON(): string {
    return JSON.stringify({
      summary: this.getPortfolioSummary(),
      equityCurve: this.equityCurve,
    }, null, 2);
  }

  /** Create a PnlSnapshot compatible with RiskManager format */
  toPnlSnapshot(): PnlSnapshot {
    const s = this.getPortfolioSummary();
    return {
      timestamp: s.snapshotAt,
      equity: String(s.totalEquity),
      peakEquity: String(s.peakEquity),
      drawdown: s.drawdown,
      realizedPnl: String(s.totalRealizedPnl),
      unrealizedPnl: String(s.totalUnrealizedPnl),
      tradeCount: s.totalTradeCount,
      winCount: s.totalWinCount,
    };
  }

  // ── private ────────────────────────────────────────────────────────────────

  private _getOrCreateLedger(name: StrategyName): StrategyLedger {
    if (!this.ledgers.has(name)) {
      const initial = this.initialCapital.get(name) ?? 0;
      this.ledgers.set(name, {
        equity: initial,
        realizedPnl: 0,
        tradeCount: 0,
        winCount: 0,
        totalWinAmount: 0,
        totalLossAmount: 0,
      });
    }
    return this.ledgers.get(name)!;
  }

  private _totalEquity(): number {
    let total = 0;
    for (const l of this.ledgers.values()) total += l.equity;
    return total;
  }

  private _updatePeak(): void {
    const eq = this._totalEquity();
    if (eq > this.peakEquity) this.peakEquity = eq;
  }

  private _recordEquityPoint(): void {
    this.equityCurve.push({ timestamp: Date.now(), equity: this._totalEquity() });
  }
}

// ── module-level helpers ──────────────────────────────────────────────────────

/**
 * Estimate trade P&L from fill data.
 * For a buy: pnl is deferred until close — we track fees only.
 * For a sell (close): approximated as (fillPrice - implicit cost) * size.
 * Callers with richer data should supply explicit pnl via a wrapper.
 */
function _computeTradePnl(trade: TradeResult): number {
  // Fees are always a cost regardless of side
  const fees = parseFloat(trade.fees);
  const price = parseFloat(trade.fillPrice);
  const size = parseFloat(trade.fillSize);

  // sell = realizing value; buy = deploying capital (neutral pnl until close)
  if (trade.side === 'sell') {
    return price * size - fees;
  }
  return -(price * size + fees);
}
