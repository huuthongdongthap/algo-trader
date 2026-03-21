// Passive market making strategy for Polymarket binary markets
// Places bid/ask orders around midpoint, harvests spread, manages inventory
import type { Order, Position, StrategyConfig, PnlSnapshot } from '../../core/types.js';
import { RiskManager } from '../../core/risk-manager.js';
import { logger } from '../../core/logger.js';
import { sleep } from '../../core/utils.js';
import type { ClobClient } from '../../polymarket/clob-client.js';
import type { MarketOpportunity } from '../../polymarket/market-scanner.js';

// --- Config & state types ---

export interface MMConfig {
  /** Base spread as decimal (0.01 = 1%) */
  baseSpreadPct: number;
  /** Spread multiplier when volatility is high */
  volatilityMultiplier: number;
  /** Quote size in USDC per side */
  quoteSizeUsdc: number;
  /** Refresh orders if mid moves beyond this fraction of spread */
  refreshThreshold: number;
  /** Cancel and replace interval in ms */
  refreshIntervalMs: number;
  /** Rebalance when abs(inventory) exceeds this fraction of maxSize */
  inventorySkewThreshold: number;
}

interface MarketMakerState {
  tokenId: string;
  bidOrder: Order | null;
  askOrder: Order | null;
  midPrice: number;
  inventory: number;       // signed: +long, -short
  realizedPnl: number;
  quotedAt: number;
}

const DEFAULT_CONFIG: MMConfig = {
  baseSpreadPct: 0.01,
  volatilityMultiplier: 2.0,
  quoteSizeUsdc: 50,
  refreshThreshold: 0.5,
  refreshIntervalMs: 15_000,
  inventorySkewThreshold: 0.5,
};

// --- Strategy ---

export class MarketMakerStrategy {
  readonly name = 'market-maker';

  private config: MMConfig;
  private riskMgr: RiskManager;
  private client: ClobClient;
  private capital: string;

  private running = false;
  private markets: MarketMakerState[] = [];
  private corePositions: Position[] = [];
  private totalTrades = 0;
  private winTrades = 0;
  private pnlSnapshot: PnlSnapshot | null = null;

  constructor(
    client: ClobClient,
    config: StrategyConfig,
    capital: string,
  ) {
    this.client = client;
    this.capital = capital;
    this.config = { ...DEFAULT_CONFIG, ...(config.params as Partial<MMConfig>) };
    this.riskMgr = new RiskManager({
      maxPositionSize: String(this.config.quoteSizeUsdc * 4),
      maxDrawdown: 0.10,
      maxOpenPositions: 20,
      stopLossPercent: 0.05,
      maxLeverage: 1,
    });
  }

  /** Add a market to make quotes on */
  addMarket(opp: MarketOpportunity): void {
    const exists = this.markets.find(m => m.tokenId === opp.yesTokenId);
    if (exists) return;
    this.markets.push({
      tokenId: opp.yesTokenId,
      bidOrder: null,
      askOrder: null,
      midPrice: opp.yesMidPrice,
      inventory: 0,
      realizedPnl: 0,
      quotedAt: 0,
    });
    logger.info('MM market added', this.name, { conditionId: opp.conditionId });
  }

  async start(): Promise<void> {
    logger.info('Starting market maker', this.name, { markets: this.markets.length });
    this.running = true;
    await this.runLoop();
  }

  async stop(): Promise<void> {
    logger.info('Stopping market maker', this.name);
    this.running = false;
    await this.cancelAllQuotes();
  }

  getStatus() {
    return {
      running: this.running,
      activeMarkets: this.markets.length,
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
      for (const state of this.markets) {
        if (!this.running) break;
        await this.refreshQuotes(state).catch(err =>
          logger.error('Quote refresh failed', this.name, { tokenId: state.tokenId, err: String(err) }),
        );
      }
      await sleep(this.config.refreshIntervalMs);
    }
  }

  private async refreshQuotes(state: MarketMakerState): Promise<void> {
    // Fetch current mid price
    const priceData = await this.client.getPrice(state.tokenId);
    const mid = parseFloat(priceData.mid);
    const bid = parseFloat(priceData.bid);
    const ask = parseFloat(priceData.ask);
    const volatility = ask > 0 && bid > 0 ? (ask - bid) / mid : 0;

    // Decide if refresh needed
    const midMoved = state.midPrice > 0
      ? Math.abs(mid - state.midPrice) / state.midPrice
      : 1;
    const stale = Date.now() - state.quotedAt > this.config.refreshIntervalMs;

    if (!stale && midMoved < this.config.refreshThreshold * this.config.baseSpreadPct) {
      return; // No refresh needed
    }

    // Cancel existing quotes
    await this.cancelQuotes(state);

    // Risk gate
    const sizeStr = String(this.config.quoteSizeUsdc);
    const check = this.riskMgr.canOpenPosition(this.capital, this.corePositions, sizeStr);
    if (!check.allowed) {
      logger.warn('MM risk gate blocked quote', this.name, { reason: check.reason });
      return;
    }

    // Calculate spread: wider when volatile
    const dynamicSpread = this.config.baseSpreadPct * (1 + volatility * this.config.volatilityMultiplier);

    // Inventory skew: if long, lower bid price to reduce buying; raise ask to offload
    const inventoryRatio = state.inventory / (this.config.quoteSizeUsdc * 2);
    const skew = inventoryRatio * this.config.baseSpreadPct * this.config.inventorySkewThreshold;

    const quoteBid = mid - dynamicSpread / 2 - skew;
    const quoteAsk = mid + dynamicSpread / 2 - skew;
    const tokenSize = (this.config.quoteSizeUsdc / mid).toFixed(2);

    // Place both sides
    const [bidOrder, askOrder] = await Promise.all([
      this.client.postOrder({
        tokenId: state.tokenId,
        price: quoteBid.toFixed(4),
        size: tokenSize,
        side: 'buy',
        orderType: 'GTC',
      }),
      this.client.postOrder({
        tokenId: state.tokenId,
        price: quoteAsk.toFixed(4),
        size: tokenSize,
        side: 'sell',
        orderType: 'GTC',
      }),
    ]);

    state.bidOrder = bidOrder;
    state.askOrder = askOrder;
    state.midPrice = mid;
    state.quotedAt = Date.now();
    this.totalTrades += 2;

    logger.debug('Quotes placed', this.name, {
      tokenId: state.tokenId,
      bid: quoteBid.toFixed(4),
      ask: quoteAsk.toFixed(4),
      spread: (dynamicSpread * 100).toFixed(2) + '%',
    });

    this.updatePnlSnapshot();
  }

  private async cancelQuotes(state: MarketMakerState): Promise<void> {
    const cancels: Promise<boolean>[] = [];
    if (state.bidOrder) cancels.push(this.client.cancelOrder(state.bidOrder.id));
    if (state.askOrder) cancels.push(this.client.cancelOrder(state.askOrder.id));
    if (cancels.length > 0) await Promise.allSettled(cancels);
    state.bidOrder = null;
    state.askOrder = null;
  }

  private async cancelAllQuotes(): Promise<void> {
    for (const state of this.markets) {
      await this.cancelQuotes(state).catch(err =>
        logger.warn('Cancel quotes error on shutdown', this.name, { err: String(err) }),
      );
    }
    logger.info('All MM quotes cancelled', this.name);
  }

  private updatePnlSnapshot(): void {
    const totalRealizedPnl = this.markets.reduce((sum, m) => sum + m.realizedPnl, 0);
    this.pnlSnapshot = this.riskMgr.createSnapshot(
      this.capital,
      totalRealizedPnl.toFixed(2),
      '0',
      this.totalTrades,
      this.winTrades,
    );
  }
}
