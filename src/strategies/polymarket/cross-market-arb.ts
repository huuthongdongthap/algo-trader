// Cross-market arbitrage strategy for Polymarket binary markets
// Logic: YES_ask + NO_ask < 1.0 → buy both sides → guaranteed profit at settlement
import type { Position, StrategyConfig, PnlSnapshot } from '../../core/types.js';
import { RiskManager } from '../../core/risk-manager.js';
import { logger } from '../../core/logger.js';
import { sleep } from '../../core/utils.js';
import type { ClobClient } from '../../polymarket/clob-client.js';
import type { MarketScanner, MarketOpportunity } from '../../polymarket/market-scanner.js';

// --- Config & state types ---

export interface ArbConfig {
  /** Min net profit threshold (after gas + slippage) */
  minNetProfitPct: number;
  /** Estimated gas + fees in USDC */
  gasCostUsdc: number;
  /** Slippage estimate as decimal (0.005 = 0.5%) */
  slippageEstimate: number;
  /** Default trade size in USDC */
  defaultSizeUsdc: number;
  /** Scan interval in ms */
  scanIntervalMs: number;
  /** Max stale orderbook age in ms */
  maxBookAgeMs: number;
  /** Condition IDs to skip */
  blacklist?: string[];
}

interface ArbPosition {
  conditionId: string;
  yesOrderId: string;
  noOrderId: string;
  yesFillPrice: number;
  noFillPrice: number;
  sizeUsdc: number;
  lockedProfit: number;
  openedAt: number;
}

const DEFAULT_CONFIG: ArbConfig = {
  minNetProfitPct: 0.005,   // 0.5% minimum
  gasCostUsdc: 0.3,
  slippageEstimate: 0.005,
  defaultSizeUsdc: 100,
  scanIntervalMs: 5_000,
  maxBookAgeMs: 10_000,
};

// --- Strategy ---

export class CrossMarketArbStrategy {
  readonly name = 'cross-market-arb';

  private config: ArbConfig;
  private riskMgr: RiskManager;
  private client: ClobClient;
  private scanner: MarketScanner;
  private capital: string;

  private running = false;
  private positions: ArbPosition[] = [];
  private corePositions: Position[] = []; // for risk checks
  private totalTrades = 0;
  private winTrades = 0;
  private realizedPnl = 0;
  private pnlSnapshot: PnlSnapshot | null = null;

  constructor(
    client: ClobClient,
    scanner: MarketScanner,
    config: StrategyConfig,
    capital: string,
  ) {
    this.client = client;
    this.scanner = scanner;
    this.capital = capital;
    this.config = { ...DEFAULT_CONFIG, ...(config.params as Partial<ArbConfig>) };
    this.riskMgr = new RiskManager({
      maxPositionSize: String(this.config.defaultSizeUsdc * 5),
      maxDrawdown: 0.15,
      maxOpenPositions: 10,
      stopLossPercent: 0.10,
      maxLeverage: 1,
    });
  }

  async start(): Promise<void> {
    logger.info('Starting arb strategy', this.name);
    this.running = true;
    await this.runLoop();
  }

  async stop(): Promise<void> {
    logger.info('Stopping arb strategy', this.name);
    this.running = false;
    await this.cancelAllOrders();
  }

  getStatus() {
    return {
      running: this.running,
      openPositions: this.positions.length,
      totalTrades: this.totalTrades,
      winRate: this.totalTrades > 0 ? this.winTrades / this.totalTrades : 0,
    };
  }

  getPnL(): PnlSnapshot {
    if (!this.pnlSnapshot) {
      return this.riskMgr.createSnapshot(this.capital, '0', '0', 0, 0);
    }
    return this.pnlSnapshot;
  }

  // --- Core loop ---

  private async runLoop(): Promise<void> {
    while (this.running) {
      try {
        await this.scanAndExecute();
      } catch (err) {
        logger.error('Arb loop error', this.name, { err: String(err) });
      }
      await sleep(this.config.scanIntervalMs);
    }
  }

  private async scanAndExecute(): Promise<void> {
    const opportunities = await this.scanner.getTopOpportunities(20);
    for (const opp of opportunities) {
      if (!this.running) break;
      if (this.config.blacklist?.includes(opp.conditionId)) continue;
      await this.evaluateAndExecute(opp);
    }
  }

  private async evaluateAndExecute(opp: MarketOpportunity): Promise<void> {
    // Recalculate using actual ask prices (scanner gives mid prices)
    const yesAsk = opp.yesMidPrice + opp.yesSpread / 2;
    const noAsk = opp.noMidPrice + opp.noSpread / 2;
    const rawSpread = 1.0 - yesAsk - noAsk;

    // Cost model: gas + slippage on both sides
    const tradeSizeUsdc = this.config.defaultSizeUsdc;
    const slippage = (yesAsk + noAsk) * this.config.slippageEstimate;
    const totalCost = this.config.gasCostUsdc / tradeSizeUsdc + slippage;
    const netProfit = rawSpread - totalCost;

    if (netProfit <= this.config.minNetProfitPct) {
      logger.debug('Arb opportunity below threshold', this.name, {
        conditionId: opp.conditionId,
        rawSpread: rawSpread.toFixed(4),
        netProfit: netProfit.toFixed(4),
      });
      return;
    }

    // Risk check
    const sizeStr = String(tradeSizeUsdc);
    const check = this.riskMgr.canOpenPosition(this.capital, this.corePositions, sizeStr);
    if (!check.allowed) {
      logger.warn('Risk check failed', this.name, { reason: check.reason });
      return;
    }

    logger.info('Executing arb', this.name, {
      conditionId: opp.conditionId,
      yesAsk: yesAsk.toFixed(4),
      noAsk: noAsk.toFixed(4),
      netProfitPct: (netProfit * 100).toFixed(2),
    });

    await this.executeArb(opp, yesAsk, noAsk, tradeSizeUsdc, netProfit);
  }

  private async executeArb(
    opp: MarketOpportunity,
    yesAsk: number,
    noAsk: number,
    sizeUsdc: number,
    lockedProfitFraction: number,
  ): Promise<void> {
    // Execute both legs in parallel (atomic-ish)
    const yesSize = (sizeUsdc / yesAsk).toFixed(2);
    const noSize = (sizeUsdc / noAsk).toFixed(2);

    try {
      const [yesResult, noResult] = await Promise.allSettled([
        this.client.postOrder({
          tokenId: opp.yesTokenId,
          price: yesAsk.toFixed(4),
          size: yesSize,
          side: 'buy',
          orderType: 'FOK',
        }),
        this.client.postOrder({
          tokenId: opp.noTokenId,
          price: noAsk.toFixed(4),
          size: noSize,
          side: 'buy',
          orderType: 'FOK',
        }),
      ]);

      const yesOk = yesResult.status === 'fulfilled';
      const noOk = noResult.status === 'fulfilled';
      const yesOrder = yesOk ? yesResult.value : null;
      const noOrder = noOk ? noResult.value : null;

      // Both legs must fill for riskless arb. If one fails, cancel the other.
      if (yesOk && !noOk) {
        logger.warn('Arb: YES filled but NO failed — cancelling YES', this.name);
        await this.client.cancelOrder(yesOrder!.id).catch(() => {});
        this.totalTrades++;
        return;
      }
      if (!yesOk && noOk) {
        logger.warn('Arb: NO filled but YES failed — cancelling NO', this.name);
        await this.client.cancelOrder(noOrder!.id).catch(() => {});
        this.totalTrades++;
        return;
      }
      if (!yesOk && !noOk) {
        logger.debug('Arb: both legs failed (likely price moved)', this.name);
        return;
      }

      const pos: ArbPosition = {
        conditionId: opp.conditionId,
        yesOrderId: yesOrder!.id,
        noOrderId: noOrder!.id,
        yesFillPrice: yesAsk,
        noFillPrice: noAsk,
        sizeUsdc,
        lockedProfit: lockedProfitFraction * sizeUsdc,
        openedAt: Date.now(),
      };
      this.positions.push(pos);
      this.totalTrades++;
      this.winTrades++;
      this.realizedPnl += pos.lockedProfit;

      logger.info('Arb executed', this.name, {
        conditionId: opp.conditionId,
        lockedProfit: pos.lockedProfit.toFixed(4),
      });

      this.updatePnlSnapshot();
    } catch (err) {
      logger.error('Arb execution failed', this.name, { err: String(err), conditionId: opp.conditionId });
      this.totalTrades++;
    }
  }

  private async cancelAllOrders(): Promise<void> {
    for (const pos of this.positions) {
      await Promise.allSettled([
        this.client.cancelOrder(pos.yesOrderId),
        this.client.cancelOrder(pos.noOrderId),
      ]);
    }
    logger.info('All arb orders cancelled', this.name, { count: this.positions.length });
    this.positions = [];
  }

  private updatePnlSnapshot(): void {
    this.pnlSnapshot = this.riskMgr.createSnapshot(
      this.capital,
      this.realizedPnl.toFixed(2),
      '0',
      this.totalTrades,
      this.winTrades,
    );
  }
}
