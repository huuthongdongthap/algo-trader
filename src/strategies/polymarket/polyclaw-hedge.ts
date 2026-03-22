// PolyClawHedgeStrategy: autonomous hedge discovery + execution
// Uses HedgeScanner (LLM-powered) + KellyPositionSizer for position sizing
// Runs on a configurable interval, placing hedged positions on T1/T2 opportunities

import type { StrategyConfig, PnlSnapshot } from '../../core/types.js';
import { RiskManager } from '../../core/risk-manager.js';
import { logger } from '../../core/logger.js';
import { sleep } from '../../core/utils.js';
import { HedgeScanner, type HedgeScanResult } from '../../polymarket/hedge-scanner.js';
import type { HedgePortfolio } from '../../polymarket/hedge-coverage.js';
import type { AiRouter } from '../../openclaw/ai-router.js';
import type { ClobClient } from '../../polymarket/clob-client.js';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface PolyClawConfig {
  /** Scan interval in ms */
  scanIntervalMs: number;
  /** Max markets to scan per cycle */
  scanLimit: number;
  /** Max tier to consider (1=HIGH only, 2=+GOOD) */
  maxTier: number;
  /** Max position size in USDC */
  maxPositionUsdc: number;
  /** Base position size in USDC */
  basePositionUsdc: number;
  /** Max concurrent open hedges */
  maxOpenHedges: number;
}

const DEFAULT_CONFIG: PolyClawConfig = {
  scanIntervalMs: 60_000, // 1 minute
  scanLimit: 10,
  maxTier: 2,
  maxPositionUsdc: 500,
  basePositionUsdc: 50,
  maxOpenHedges: 10,
};

// ---------------------------------------------------------------------------
// Strategy
// ---------------------------------------------------------------------------

export class PolyClawHedgeStrategy {
  readonly name = 'polyclaw-hedge';

  private config: PolyClawConfig;
  private riskMgr: RiskManager;
  private scanner: HedgeScanner;
  private client: ClobClient;
  private capital: string;

  private running = false;
  private openHedges: Array<{ target: string; cover: string; sizeUsdc: number; openedAt: number }> = [];
  private totalExecuted = 0;
  private totalPnl = 0;

  constructor(
    client: ClobClient,
    ai: AiRouter,
    config: StrategyConfig,
    capital: string,
  ) {
    this.client = client;
    this.capital = capital;
    this.config = { ...DEFAULT_CONFIG, ...(config.params as Partial<PolyClawConfig>) };
    this.scanner = new HedgeScanner(ai, { maxTier: this.config.maxTier });
    this.riskMgr = new RiskManager({
      maxPositionSize: String(this.config.maxPositionUsdc),
      maxDrawdown: 0.10,
      maxOpenPositions: this.config.maxOpenHedges,
      stopLossPercent: 0.05,
      maxLeverage: 1,
    });
  }

  async start(): Promise<void> {
    logger.info('Starting PolyClawHedgeStrategy', this.name, {
      scanInterval: this.config.scanIntervalMs,
      maxTier: this.config.maxTier,
    });
    this.running = true;
    await this.runLoop();
  }

  async stop(): Promise<void> {
    this.running = false;
    logger.info('Stopped PolyClawHedgeStrategy', this.name, {
      totalExecuted: this.totalExecuted,
      openHedges: this.openHedges.length,
    });
  }

  getStatus() {
    return {
      running: this.running,
      openHedges: this.openHedges.length,
      totalExecuted: this.totalExecuted,
      totalPnl: this.totalPnl,
    };
  }

  getPnL(): PnlSnapshot {
    return this.riskMgr.createSnapshot(
      this.capital,
      this.totalPnl.toFixed(2),
      '0',
      this.totalExecuted,
      0,
    );
  }

  // ── Core loop ──────────────────────────────────────────────────────────

  private async runLoop(): Promise<void> {
    while (this.running) {
      await this.scanAndExecute().catch(err =>
        logger.error('Hedge cycle error', this.name, { err: String(err) }),
      );
      await sleep(this.config.scanIntervalMs);
    }
  }

  private async scanAndExecute(): Promise<void> {
    if (this.openHedges.length >= this.config.maxOpenHedges) {
      logger.debug('Max open hedges reached, skipping scan', this.name);
      return;
    }

    const results = await this.scanner.scanTopMarkets(this.config.scanLimit);
    const actionable = results.filter(r => r.portfolios.length > 0);

    logger.debug('Scan cycle', this.name, {
      scanned: results.length,
      actionable: actionable.length,
      cached: results.filter(r => r.cached).length,
    });

    for (const result of actionable) {
      if (!this.running) break;
      if (this.openHedges.length >= this.config.maxOpenHedges) break;

      const best = result.portfolios[0]; // already sorted by coverage desc
      await this.executeHedge(result, best);
    }
  }

  private async executeHedge(scan: HedgeScanResult, portfolio: HedgePortfolio): Promise<void> {
    // Risk gate
    const check = this.riskMgr.canOpenPosition(this.capital, [], String(this.config.basePositionUsdc));
    if (!check.allowed) {
      logger.warn('Risk gate blocked hedge', this.name, { reason: check.reason });
      return;
    }

    // Skip if already hedging this pair
    const pairKey = `${scan.targetMarket.id}:${portfolio.coverMarket.id}`;
    if (this.openHedges.some(h => `${h.target}:${h.cover}` === pairKey)) return;

    const sizeUsdc = Math.min(this.config.basePositionUsdc, this.config.maxPositionUsdc);
    const targetPrice = portfolio.targetPosition === 'YES' ? scan.targetMarket.yesPrice : scan.targetMarket.noPrice;
    const coverPrice = portfolio.coverPosition === 'YES' ? portfolio.coverMarket.yesPrice : portfolio.coverMarket.noPrice;

    // Calculate token amounts from USDC size
    const targetTokens = (sizeUsdc / targetPrice).toFixed(2);
    const coverTokens = (sizeUsdc / coverPrice).toFixed(2);

    logger.info('Executing hedge', this.name, {
      target: scan.targetMarket.question.slice(0, 50),
      cover: portfolio.coverMarket.question.slice(0, 50),
      tier: portfolio.tier,
      coverage: portfolio.coverage.toFixed(4),
      sizeUsdc,
    });

    // Place both legs
    const targetSide = portfolio.targetPosition === 'YES' ? 'buy' : 'sell';
    const coverSide = portfolio.coverPosition === 'YES' ? 'buy' : 'sell';

    await this.client.postOrder({
      tokenId: scan.targetMarket.yesTokenId,
      price: targetPrice.toFixed(4),
      size: targetTokens,
      side: targetSide,
      orderType: 'GTC',
    });

    await this.client.postOrder({
      tokenId: portfolio.coverMarket.yesTokenId || portfolio.coverId,
      price: coverPrice.toFixed(4),
      size: coverTokens,
      side: coverSide,
      orderType: 'GTC',
    });

    this.openHedges.push({
      target: scan.targetMarket.id,
      cover: portfolio.coverMarket.id,
      sizeUsdc,
      openedAt: Date.now(),
    });
    this.totalExecuted++;

    logger.info('Hedge executed', this.name, {
      tier: portfolio.tier,
      coverage: portfolio.coverage.toFixed(4),
      totalOpen: this.openHedges.length,
    });
  }
}
