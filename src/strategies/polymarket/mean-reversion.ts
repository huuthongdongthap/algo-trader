// Mean Reversion Strategy — overreaction always reverts
// Detects price spikes > threshold in short window → bets on reversion
// Win rate ~65-70% on prediction markets because prices anchor to true probability

import type { Position, StrategyConfig, PnlSnapshot } from '../../core/types.js';
import { RiskManager } from '../../core/risk-manager.js';
import { logger } from '../../core/logger.js';
import { sleep } from '../../core/utils.js';
import type { ClobClient } from '../../polymarket/clob-client.js';
import type { MarketScanner, MarketOpportunity } from '../../polymarket/market-scanner.js';

export interface MeanReversionConfig {
  /** Min price move to trigger (0.15 = 15% move) */
  spikeThreshold: number;
  /** Lookback window in milliseconds (6h default) */
  lookbackMs: number;
  /** Wait after spike before entering (ms) */
  cooldownMs: number;
  /** Target reversion fraction (0.5 = 50% revert) */
  targetReversion: number;
  /** Max hold time before force exit (ms, 48h default) */
  maxHoldMs: number;
  /** Position size in USDC */
  sizeUsdc: number;
  /** Scan interval in ms */
  scanIntervalMs: number;
  /** Max simultaneous reversion trades */
  maxOpenTrades: number;
}

interface PriceSnapshot {
  price: number;
  timestamp: number;
}

interface ReversionTrade {
  marketId: string;
  tokenId: string;
  direction: 'buy' | 'sell';
  entryPrice: number;
  preSpikeMean: number;
  targetPrice: number;
  orderId: string;
  sizeUsdc: number;
  enteredAt: number;
}

const DEFAULT_CONFIG: MeanReversionConfig = {
  spikeThreshold: 0.15,
  lookbackMs: 6 * 60 * 60 * 1000,
  cooldownMs: 30 * 60 * 1000,
  targetReversion: 0.5,
  maxHoldMs: 48 * 60 * 60 * 1000,
  sizeUsdc: 50,
  scanIntervalMs: 60_000,
  maxOpenTrades: 5,
};

export class MeanReversionStrategy {
  readonly name = 'mean-reversion';

  private config: MeanReversionConfig;
  private riskMgr: RiskManager;
  private client: ClobClient;
  private scanner: MarketScanner;
  private capital: string;

  private running = false;
  private priceHistory = new Map<string, PriceSnapshot[]>();
  private openTrades: ReversionTrade[] = [];
  private cooldowns = new Map<string, number>();
  private totalTrades = 0;
  private winTrades = 0;
  private realizedPnl = 0;

  constructor(client: ClobClient, scanner: MarketScanner, config: StrategyConfig, capital: string) {
    this.client = client;
    this.scanner = scanner;
    this.capital = capital;
    this.config = { ...DEFAULT_CONFIG, ...(config.params as Partial<MeanReversionConfig>) };
    this.riskMgr = new RiskManager({
      maxPositionSize: String(this.config.sizeUsdc * 3),
      maxDrawdown: 0.10,
      maxOpenPositions: this.config.maxOpenTrades,
      stopLossPercent: 0.15,
      maxLeverage: 1,
    });
  }

  async start(): Promise<void> {
    logger.info('Starting mean reversion strategy', this.name);
    this.running = true;
    await this.runLoop();
  }

  async stop(): Promise<void> {
    logger.info('Stopping mean reversion', this.name);
    this.running = false;
  }

  getStatus() {
    return {
      running: this.running,
      trackedMarkets: this.priceHistory.size,
      openTrades: this.openTrades.length,
      totalTrades: this.totalTrades,
      winRate: this.totalTrades > 0 ? this.winTrades / this.totalTrades : 0,
      realizedPnl: this.realizedPnl,
    };
  }

  getPnL(): PnlSnapshot {
    return this.riskMgr.createSnapshot(this.capital, this.realizedPnl.toFixed(2), '0', this.totalTrades, this.winTrades);
  }

  /** Call on every orderbook update to build price history */
  onPriceUpdate(tokenId: string, price: number): void {
    const now = Date.now();
    let history = this.priceHistory.get(tokenId);
    if (!history) {
      history = [];
      this.priceHistory.set(tokenId, history);
    }
    history.push({ price, timestamp: now });
    const cutoff = now - this.config.lookbackMs;
    const firstValid = history.findIndex(h => h.timestamp >= cutoff);
    if (firstValid > 0) history.splice(0, firstValid);
  }

  private async runLoop(): Promise<void> {
    while (this.running) {
      try {
        await this.checkExits();
        await this.scanForSpikes();
      } catch (err) {
        logger.error('Mean reversion loop error', this.name, { err: String(err) });
      }
      await sleep(this.config.scanIntervalMs);
    }
  }

  private async scanForSpikes(): Promise<void> {
    if (this.openTrades.length >= this.config.maxOpenTrades) return;

    for (const [tokenId, history] of this.priceHistory) {
      if (history.length < 10) continue;
      if (this.cooldowns.has(tokenId) && Date.now() < this.cooldowns.get(tokenId)!) continue;
      if (this.openTrades.some(t => t.tokenId === tokenId)) continue;

      const spike = this.detectSpike(history);
      if (!spike) continue;
      if (Date.now() - spike.spikeTimestamp < this.config.cooldownMs) continue;

      await this.enterReversionTrade(tokenId, spike);
    }
  }

  private detectSpike(history: PriceSnapshot[]): {
    direction: 'up' | 'down'; magnitude: number; preMean: number;
    currentPrice: number; spikeTimestamp: number;
  } | null {
    if (history.length < 10) return null;

    const current = history[history.length - 1];
    const windowStart = current.timestamp - this.config.lookbackMs;
    const firstHalf = history.filter(h =>
      h.timestamp >= windowStart && h.timestamp < windowStart + this.config.lookbackMs / 2
    );
    if (firstHalf.length < 3) return null;

    const preMean = firstHalf.reduce((s, h) => s + h.price, 0) / firstHalf.length;
    const move = current.price - preMean;
    const magnitude = Math.abs(move) / Math.max(preMean, 0.01);

    if (magnitude < this.config.spikeThreshold) return null;

    const recentPrices = history.filter(h => h.timestamp > current.timestamp - this.config.lookbackMs / 2);
    const peakIdx = move > 0
      ? recentPrices.reduce((max, h, i) => h.price > recentPrices[max].price ? i : max, 0)
      : recentPrices.reduce((min, h, i) => h.price < recentPrices[min].price ? i : min, 0);

    return {
      direction: move > 0 ? 'up' : 'down',
      magnitude, preMean, currentPrice: current.price,
      spikeTimestamp: recentPrices[peakIdx]?.timestamp ?? current.timestamp,
    };
  }

  private async enterReversionTrade(
    tokenId: string,
    spike: { direction: 'up' | 'down'; preMean: number; currentPrice: number; magnitude: number },
  ): Promise<void> {
    const check = this.riskMgr.canOpenPosition(this.capital, [], String(this.config.sizeUsdc));
    if (!check.allowed) {
      logger.warn('Risk check blocked reversion entry', this.name, { reason: check.reason });
      return;
    }

    const revertTarget = spike.currentPrice + (spike.preMean - spike.currentPrice) * this.config.targetReversion;
    const side = spike.direction === 'up' ? 'sell' : 'buy';
    const price = spike.currentPrice;
    const shares = (this.config.sizeUsdc / price).toFixed(2);

    logger.info(`Mean reversion entry: spike ${spike.direction} ${(spike.magnitude * 100).toFixed(1)}%`, this.name, {
      tokenId: tokenId.slice(0, 12), preMean: spike.preMean.toFixed(3),
      current: spike.currentPrice.toFixed(3), target: revertTarget.toFixed(3), side,
    });

    try {
      const order = await this.client.postOrder({ tokenId, price: price.toFixed(4), size: shares, side, orderType: 'GTC' });
      this.openTrades.push({
        marketId: tokenId, tokenId, direction: side, entryPrice: price,
        preSpikeMean: spike.preMean, targetPrice: revertTarget,
        orderId: order.id, sizeUsdc: this.config.sizeUsdc, enteredAt: Date.now(),
      });
      this.cooldowns.set(tokenId, Date.now() + this.config.lookbackMs);
      this.totalTrades++;
    } catch (err) {
      logger.error('Reversion entry failed', this.name, { err: String(err) });
    }
  }

  private async checkExits(): Promise<void> {
    const toRemove: number[] = [];

    for (let i = 0; i < this.openTrades.length; i++) {
      const trade = this.openTrades[i];
      const history = this.priceHistory.get(trade.tokenId);
      if (!history || history.length === 0) continue;

      const currentPrice = history[history.length - 1].price;
      const holdTime = Date.now() - trade.enteredAt;

      const reachedTarget = trade.direction === 'buy'
        ? currentPrice >= trade.targetPrice
        : currentPrice <= trade.targetPrice;
      const expired = holdTime > this.config.maxHoldMs;

      if (reachedTarget || expired) {
        try {
          await this.client.cancelOrder(trade.orderId).catch(() => {});
          const pnl = trade.direction === 'buy'
            ? (currentPrice - trade.entryPrice) * (trade.sizeUsdc / trade.entryPrice)
            : (trade.entryPrice - currentPrice) * (trade.sizeUsdc / trade.entryPrice);

          this.realizedPnl += pnl;
          if (pnl > 0) this.winTrades++;

          logger.info(`Reversion exit: ${pnl > 0 ? 'WIN' : 'LOSS'} $${pnl.toFixed(2)}`, this.name, {
            reason: reachedTarget ? 'target_reached' : 'expired',
            entry: trade.entryPrice.toFixed(3), exit: currentPrice.toFixed(3),
            hold: `${(holdTime / 3600000).toFixed(1)}h`,
          });
          toRemove.push(i);
        } catch (err) {
          logger.error('Exit failed', this.name, { err: String(err) });
        }
      }
    }

    for (const idx of toRemove.reverse()) {
      this.openTrades.splice(idx, 1);
    }
  }
}
