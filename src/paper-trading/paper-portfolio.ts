// Virtual portfolio for paper trading: tracks balances, P&L, and equity
// All monetary values stored as numbers internally; exposed as decimal strings

import { logger } from '../core/logger.js';
import { formatPrice } from '../core/utils.js';
import type { TradeResult } from '../core/types.js';

export interface PortfolioSnapshot {
  balances: Record<string, string>;
  realizedPnl: string;
  unrealizedPnl: string;
  totalEquityUsdc: string;
  initialCapital: string;
}

/**
 * PaperPortfolio: maintains virtual asset balances and P&L tracking.
 * USDC is the settlement currency for equity calculations.
 */
export class PaperPortfolio {
  private balances: Map<string, number> = new Map();
  private initialCapital: number;
  private realizedPnl: number = 0;
  /** Average entry prices per asset for unrealized P&L */
  private avgEntryPrices: Map<string, number> = new Map();

  constructor(initialCapital: number) {
    if (initialCapital <= 0) throw new Error('initialCapital must be positive');
    this.initialCapital = initialCapital;
    // Seed with starting USDC balance
    this.balances.set('USDC', initialCapital);
  }

  // ─── Balance management ──────────────────────────────────────────────────────

  deposit(asset: string, amount: number): void {
    if (amount <= 0) throw new Error(`Deposit amount must be positive, got ${amount}`);
    const current = this.balances.get(asset) ?? 0;
    this.balances.set(asset, current + amount);
    logger.debug(`[PaperPortfolio] Deposit ${amount} ${asset} → balance ${current + amount}`, 'PaperPortfolio');
  }

  withdraw(asset: string, amount: number): void {
    if (amount <= 0) throw new Error(`Withdrawal amount must be positive, got ${amount}`);
    const current = this.balances.get(asset) ?? 0;
    if (current < amount) throw new Error(`Insufficient ${asset}: have ${current}, need ${amount}`);
    this.balances.set(asset, current - amount);
    logger.debug(`[PaperPortfolio] Withdraw ${amount} ${asset} → balance ${current - amount}`, 'PaperPortfolio');
  }

  getBalance(asset: string): number {
    return this.balances.get(asset) ?? 0;
  }

  getAllBalances(): Record<string, number> {
    const result: Record<string, number> = {};
    for (const [asset, bal] of this.balances) {
      if (bal !== 0) result[asset] = bal;
    }
    return result;
  }

  // ─── Trade application ───────────────────────────────────────────────────────

  /**
   * Apply a filled trade result to update balances and realized P&L.
   * Assumes quote currency is always USDC.
   */
  applyTrade(result: TradeResult): void {
    const fillPrice = parseFloat(result.fillPrice);
    const fillSize = parseFloat(result.fillSize);
    const fees = parseFloat(result.fees);
    const notional = fillPrice * fillSize;

    // Extract base asset from marketId (e.g. "BTC-USDC" → "BTC")
    const base = result.marketId.split('-')[0] ?? result.marketId;

    if (result.side === 'buy') {
      // Deduct USDC, receive base asset
      this.withdraw('USDC', notional + fees);
      const prevSize = this.getBalance(base);
      const prevAvg = this.avgEntryPrices.get(base) ?? 0;
      // Weighted average entry price
      const newSize = prevSize + fillSize;
      const newAvg = newSize > 0 ? (prevAvg * prevSize + fillPrice * fillSize) / newSize : fillPrice;
      this.deposit(base, fillSize);
      this.avgEntryPrices.set(base, newAvg);
    } else {
      // Sell: receive USDC, reduce base asset
      const avgEntry = this.avgEntryPrices.get(base) ?? fillPrice;
      const tradePnl = (fillPrice - avgEntry) * fillSize - fees;
      this.realizedPnl += tradePnl;
      this.withdraw(base, fillSize);
      this.deposit('USDC', notional - fees);
      if (this.getBalance(base) === 0) this.avgEntryPrices.delete(base);
    }
  }

  // ─── P&L & equity ────────────────────────────────────────────────────────────

  /**
   * Total portfolio value in USDC.
   * @param priceMap symbol → current price (e.g. { BTC: 65000 })
   */
  getEquity(priceMap: Record<string, number>): number {
    let equity = this.getBalance('USDC');
    for (const [asset, bal] of this.balances) {
      if (asset === 'USDC' || bal === 0) continue;
      const price = priceMap[asset] ?? 0;
      equity += bal * price;
    }
    return equity;
  }

  getRealizedPnl(): number {
    return this.realizedPnl;
  }

  getUnrealizedPnl(priceMap: Record<string, number>): number {
    let unrealized = 0;
    for (const [asset, bal] of this.balances) {
      if (asset === 'USDC' || bal === 0) continue;
      const currentPrice = priceMap[asset] ?? 0;
      const avgEntry = this.avgEntryPrices.get(asset) ?? 0;
      unrealized += (currentPrice - avgEntry) * bal;
    }
    return unrealized;
  }

  getTotalPnl(priceMap: Record<string, number> = {}): number {
    return this.realizedPnl + this.getUnrealizedPnl(priceMap);
  }

  // ─── Snapshot & reset ────────────────────────────────────────────────────────

  getSnapshot(priceMap: Record<string, number> = {}): PortfolioSnapshot {
    const balancesRecord: Record<string, string> = {};
    for (const [asset, bal] of this.balances) {
      if (bal !== 0) balancesRecord[asset] = formatPrice(bal);
    }
    return {
      balances: balancesRecord,
      realizedPnl: formatPrice(this.realizedPnl),
      unrealizedPnl: formatPrice(this.getUnrealizedPnl(priceMap)),
      totalEquityUsdc: formatPrice(this.getEquity(priceMap)),
      initialCapital: formatPrice(this.initialCapital),
    };
  }

  reset(): void {
    this.balances.clear();
    this.avgEntryPrices.clear();
    this.realizedPnl = 0;
    this.balances.set('USDC', this.initialCapital);
    logger.info(`[PaperPortfolio] Reset to initial capital ${this.initialCapital} USDC`, 'PaperPortfolio');
  }
}
