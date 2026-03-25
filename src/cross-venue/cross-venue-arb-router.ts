// Cross-venue arbitrage router — coordinates order execution between Polymarket + Kalshi
// Takes arb opportunities from KalshiMarketScanner and executes paired trades
import type { CrossPlatformOpportunity } from '../kalshi/kalshi-market-scanner.js';
import { logger } from '../core/logger.js';

// Use structural typing for KalshiOrderPlacer to avoid tight coupling
export interface KalshiOrderPlacer {
  submitOrder(opportunity: CrossPlatformOpportunity, size: number): Promise<{ id: string }>;
}

export interface ArbExecution {
  opportunity: CrossPlatformOpportunity;
  buyVenue: 'polymarket' | 'kalshi';
  sellVenue: 'polymarket' | 'kalshi';
  size: number;
  expectedProfit: number;
  status: 'pending' | 'partial' | 'filled' | 'failed';
  buyOrderId?: string;
  sellOrderId?: string;
  executedAt?: number;
  error?: string;
}

export interface ArbRouterConfig {
  /** Minimum spread to execute (default 3%) */
  minSpread: number;
  /** Maximum position size per leg in USD */
  maxPositionSize: number;
  /** Paper mode — log but don't execute */
  paperMode: boolean;
  /** Max concurrent arb positions */
  maxConcurrent: number;
}

const DEFAULT_CONFIG: ArbRouterConfig = {
  minSpread: 0.03,
  maxPositionSize: 100,
  paperMode: true,
  maxConcurrent: 3,
};

// Polymarket order placer interface — injected to avoid circular deps
export interface PolymarketOrderPlacer {
  placeOrder(conditionId: string, side: 'buy' | 'sell', size: number, price: number): Promise<string>;
}

export class CrossVenueArbRouter {
  private readonly config: ArbRouterConfig;
  private readonly activeArbs: ArbExecution[] = [];
  private kalshiOrders: KalshiOrderPlacer | null = null;
  private polyPlacer: PolymarketOrderPlacer | null = null;

  constructor(config?: Partial<ArbRouterConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /** Inject venue order managers */
  wireVenues(kalshi: KalshiOrderPlacer, poly: PolymarketOrderPlacer): void {
    this.kalshiOrders = kalshi;
    this.polyPlacer = poly;
  }

  /**
   * Evaluate and optionally execute arb opportunities.
   * Returns list of executions (paper or live).
   */
  async executeArbs(opportunities: CrossPlatformOpportunity[]): Promise<ArbExecution[]> {
    const viable = opportunities.filter(o => o.spread >= this.config.minSpread);
    const capacity = this.config.maxConcurrent - this.activeArbs.filter(a => a.status === 'pending').length;

    if (capacity <= 0) {
      logger.info('Max concurrent arbs reached — skipping', 'ArbRouter', { active: this.activeArbs.length });
      return [];
    }

    const toExecute = viable.slice(0, capacity);
    const executions: ArbExecution[] = [];

    for (const opp of toExecute) {
      const exec = await this.executeOne(opp);
      executions.push(exec);
      this.activeArbs.push(exec);
    }

    return executions;
  }

  /** Get all arb executions */
  getExecutions(): ArbExecution[] {
    return [...this.activeArbs];
  }

  /** Get active (non-terminal) arb count */
  getActiveCount(): number {
    return this.activeArbs.filter(a => a.status === 'pending' || a.status === 'partial').length;
  }

  // ── Private ────────────────────────────────────────────────────────────────

  private async executeOne(opp: CrossPlatformOpportunity): Promise<ArbExecution> {
    const buyVenue = opp.direction === 'buy-kalshi' ? 'kalshi' : 'polymarket';
    const sellVenue = opp.direction === 'buy-kalshi' ? 'polymarket' : 'kalshi';
    const buyPrice = buyVenue === 'kalshi' ? opp.kalshiPrice : opp.polymarketPrice;
    const size = Math.min(this.config.maxPositionSize / buyPrice, this.config.maxPositionSize);
    const expectedProfit = opp.spread * size;

    const exec: ArbExecution = {
      opportunity: opp,
      buyVenue,
      sellVenue,
      size,
      expectedProfit,
      status: 'pending',
    };

    if (this.config.paperMode) {
      exec.status = 'filled';
      exec.buyOrderId = `paper-buy-${Date.now()}`;
      exec.sellOrderId = `paper-sell-${Date.now()}`;
      exec.executedAt = Date.now();
      logger.info('Paper arb executed', 'ArbRouter', {
        buy: buyVenue, sell: sellVenue,
        spread: opp.spread.toFixed(4), size, expectedProfit: expectedProfit.toFixed(2),
      });
      return exec;
    }

    // Live execution
    if (!this.kalshiOrders || !this.polyPlacer) {
      exec.status = 'failed';
      exec.error = 'Venue order managers not wired';
      return exec;
    }

    try {
      // Execute buy leg first (lower price venue)
      if (buyVenue === 'kalshi') {
        const order = await this.kalshiOrders.submitOrder(opp, size);
        exec.buyOrderId = order.id;
      } else {
        exec.buyOrderId = await this.polyPlacer.placeOrder(
          opp.polymarketConditionId, 'buy', size, opp.polymarketPrice,
        );
      }

      // Execute sell leg (higher price venue)
      if (sellVenue === 'kalshi') {
        // Flip direction for the sell-side Kalshi order
        const sellOpp = { ...opp, direction: 'buy-kalshi' as const };
        const order = await this.kalshiOrders.submitOrder(sellOpp, size);
        exec.sellOrderId = order.id;
      } else {
        exec.sellOrderId = await this.polyPlacer.placeOrder(
          opp.polymarketConditionId, 'sell', size, opp.polymarketPrice,
        );
      }

      exec.status = 'filled';
      exec.executedAt = Date.now();
      logger.info('Live arb executed', 'ArbRouter', {
        buyOrderId: exec.buyOrderId, sellOrderId: exec.sellOrderId,
        spread: opp.spread.toFixed(4), expectedProfit: expectedProfit.toFixed(2),
      });
    } catch (err) {
      exec.status = 'failed';
      exec.error = err instanceof Error ? err.message : String(err);
      logger.error('Arb execution failed', 'ArbRouter', { error: exec.error });
    }

    return exec;
  }
}
