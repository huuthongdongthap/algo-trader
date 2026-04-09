/**
 * Strategy wiring — registers strategy tick functions with StrategyOrchestrator.
 * Pure orchestration: creates tick factories and wires them into the orchestrator.
 *
 * When NATS_URL (or REDIS_URL) is set, also initialises the NATS event loop so
 * strategies can receive event-driven market updates in addition to tick polling.
 */
import { StrategyOrchestrator } from '../strategies/strategy-orchestrator.js';
import { createPolymarketArbTick } from '../strategies/polymarket-arb-strategy.js';
import { createGridDcaTick } from '../strategies/grid-dca-strategy.js';
import { createBookImbalanceReversalTick } from '../strategies/polymarket/book-imbalance-reversal.js';
import { createVwapDeviationSniperTick } from '../strategies/polymarket/vwap-deviation-sniper.js';
import { createPairsStatArbTick } from '../strategies/polymarket/pairs-stat-arb.js';
import { createSessionVolSniperTick } from '../strategies/polymarket/session-vol-sniper.js';
import { createOrderbookDepthRatioTick } from '../strategies/polymarket/orderbook-depth-ratio.js';
import { createCrossEventDriftTick } from '../strategies/polymarket/cross-event-drift.js';
import { createVolCompressionBreakoutTick } from '../strategies/polymarket/vol-compression-breakout.js';
import { createWhaleTrackerTick } from '../strategies/polymarket/whale-tracker.js';
import { createResolutionFrontrunnerTick } from '../strategies/polymarket/resolution-frontrunner.js';
import { createMultiLegHedgeTick } from '../strategies/polymarket/multi-leg-hedge.js';
import { createRegimeAdaptiveMomentumTick } from '../strategies/polymarket/regime-adaptive-momentum.js';
import { createLiquidationCascadeTick } from '../strategies/polymarket/liquidation-cascade.js';
import { createOrderFlowToxicityTick } from '../strategies/polymarket/order-flow-toxicity.js';
import { createGammaScalpingTick } from '../strategies/polymarket/gamma-scalping.js';
import { createFundingRateArbTick } from '../strategies/polymarket/funding-rate-arb.js';
import { createExpiryThetaDecayTick } from '../strategies/polymarket/expiry-theta-decay.js';
import { createMicrostructureAlphaTick } from '../strategies/polymarket/microstructure-alpha.js';
import { createSentimentMomentumTick } from '../strategies/polymarket/sentiment-momentum.js';
import { createSmartMoneyDivergenceTick } from '../strategies/polymarket/smart-money-divergence.js';
import { createVolatilitySurfaceArbTick } from '../strategies/polymarket/volatility-surface-arb.js';
import { createNewsCatalystFadeTick } from '../strategies/polymarket/news-catalyst-fade.js';
import { createInventorySkewRebalancerTick } from '../strategies/polymarket/inventory-skew-rebalancer.js';
import { createKalmanFilterTrackerTick } from '../strategies/polymarket/kalman-filter-tracker.js';
import { createLiquidityVacuumTick } from '../strategies/polymarket/liquidity-vacuum.js';
import { createTwapAccumulatorTick } from '../strategies/polymarket/twap-accumulator.js';
import { createCorrelationBreakdownTick } from '../strategies/polymarket/correlation-breakdown.js';
import { createEntropyScorerTick } from '../strategies/polymarket/entropy-scorer.js';
import { createAdverseSelectionFilterTick } from '../strategies/polymarket/adverse-selection-filter.js';
import { createMomentumExhaustionTick } from '../strategies/polymarket/momentum-exhaustion.js';
import { createCrossPlatformBasisTick } from '../strategies/polymarket/cross-platform-basis.js';
import type { MarketScanner } from '../polymarket/market-scanner.js';
import type { OrderManager } from '../polymarket/order-manager.js';
import type { OrderExecutor } from '../cex/order-executor.js';
import type { ExchangeClient } from '../cex/exchange-client.js';
import type { EventBus } from '../events/event-bus.js';
import type { GammaClient } from '../polymarket/gamma-client.js';
import type { ClobClient } from '../polymarket/clob-client.js';
import { startNatsEventLoop } from './nats-event-loop.js';
import type { NatsEventLoop } from './nats-event-loop.js';

export interface WireStrategyDeps {
  eventBus: EventBus;
  scanner?: MarketScanner;
  orderManager?: OrderManager;
  cexExecutor?: OrderExecutor;
  cexClient?: ExchangeClient;
  clobClient?: ClobClient;
  gammaClient?: GammaClient;
}

/** @deprecated Use WireStrategyDeps */
export type PolymarketDeps = Pick<WireStrategyDeps, 'eventBus' | 'scanner' | 'orderManager'>;
/** @deprecated Use WireStrategyDeps */
export type CexDexDeps = Pick<WireStrategyDeps, 'eventBus' | 'cexExecutor' | 'cexClient'>;
/** @deprecated Use WireStrategyDeps */
export type AllStrategyDeps = WireStrategyDeps;

const env = (key: string, fallback: string) => process.env[key] ?? fallback;

// Data-driven Polymarket strategy definitions — eliminates DRY violation
const POLY_STRATEGIES: Array<{ id: string; name: string; envKey: string; defaultMs: string; factory: Function }> = [
  { id: 'book-imbalance', name: 'Book Imbalance Reversal', envKey: 'BOOK_IMBALANCE_INTERVAL_MS', defaultMs: '15000', factory: createBookImbalanceReversalTick },
  { id: 'vwap-sniper', name: 'VWAP Deviation Sniper', envKey: 'VWAP_SNIPER_INTERVAL_MS', defaultMs: '10000', factory: createVwapDeviationSniperTick },
  { id: 'pairs-stat-arb', name: 'Pairs Statistical Arbitrage', envKey: 'PAIRS_STAT_ARB_INTERVAL_MS', defaultMs: '30000', factory: createPairsStatArbTick },
  { id: 'session-vol-sniper', name: 'Session Volatility Sniper', envKey: 'SESSION_VOL_SNIPER_INTERVAL_MS', defaultMs: '5000', factory: createSessionVolSniperTick },
  { id: 'orderbook-depth', name: 'Orderbook Depth Ratio', envKey: 'ORDERBOOK_DEPTH_INTERVAL_MS', defaultMs: '10000', factory: createOrderbookDepthRatioTick },
  { id: 'cross-event-drift', name: 'Cross-Event Drift Catcher', envKey: 'CROSS_EVENT_DRIFT_INTERVAL_MS', defaultMs: '15000', factory: createCrossEventDriftTick },
  { id: 'vol-compression', name: 'Volatility Compression Breakout', envKey: 'VOL_COMPRESSION_INTERVAL_MS', defaultMs: '8000', factory: createVolCompressionBreakoutTick },
  { id: 'whale-tracker', name: 'Whale Tracker', envKey: 'WHALE_TRACKER_INTERVAL_MS', defaultMs: '10000', factory: createWhaleTrackerTick },
  { id: 'resolution-frontrunner', name: 'Resolution Frontrunner', envKey: 'RESOLUTION_FRONTRUNNER_INTERVAL_MS', defaultMs: '30000', factory: createResolutionFrontrunnerTick },
  { id: 'multi-leg-hedge', name: 'Multi-Leg Hedge', envKey: 'MULTI_LEG_HEDGE_INTERVAL_MS', defaultMs: '20000', factory: createMultiLegHedgeTick },
  { id: 'regime-adaptive-momentum', name: 'Regime-Adaptive Momentum', envKey: 'REGIME_MOMENTUM_INTERVAL_MS', defaultMs: '10000', factory: createRegimeAdaptiveMomentumTick },
  { id: 'liquidation-cascade', name: 'Liquidation Cascade', envKey: 'LIQUIDATION_CASCADE_INTERVAL_MS', defaultMs: '5000', factory: createLiquidationCascadeTick },
  { id: 'order-flow-toxicity', name: 'Order Flow Toxicity', envKey: 'ORDER_FLOW_TOXICITY_INTERVAL_MS', defaultMs: '8000', factory: createOrderFlowToxicityTick },
  { id: 'gamma-scalping', name: 'Gamma Scalping', envKey: 'GAMMA_SCALPING_INTERVAL_MS', defaultMs: '10000', factory: createGammaScalpingTick },
  { id: 'funding-rate-arb', name: 'Funding Rate Arbitrage', envKey: 'FUNDING_RATE_ARB_INTERVAL_MS', defaultMs: '15000', factory: createFundingRateArbTick },
  { id: 'expiry-theta-decay', name: 'Expiry Theta Decay', envKey: 'EXPIRY_THETA_DECAY_INTERVAL_MS', defaultMs: '20000', factory: createExpiryThetaDecayTick },
  { id: 'microstructure-alpha', name: 'Microstructure Alpha', envKey: 'MICROSTRUCTURE_ALPHA_INTERVAL_MS', defaultMs: '3000', factory: createMicrostructureAlphaTick },
  { id: 'sentiment-momentum', name: 'Sentiment Momentum', envKey: 'SENTIMENT_MOMENTUM_INTERVAL_MS', defaultMs: '10000', factory: createSentimentMomentumTick },
  { id: 'smart-money-divergence', name: 'Smart Money Divergence', envKey: 'SMART_MONEY_DIVERGENCE_INTERVAL_MS', defaultMs: '10000', factory: createSmartMoneyDivergenceTick },
  { id: 'volatility-surface-arb', name: 'Volatility Surface Arb', envKey: 'VOLATILITY_SURFACE_ARB_INTERVAL_MS', defaultMs: '15000', factory: createVolatilitySurfaceArbTick },
  { id: 'news-catalyst-fade', name: 'News Catalyst Fade', envKey: 'NEWS_CATALYST_FADE_INTERVAL_MS', defaultMs: '10000', factory: createNewsCatalystFadeTick },
  { id: 'inventory-skew-rebalancer', name: 'Inventory Skew Rebalancer', envKey: 'INVENTORY_SKEW_INTERVAL_MS', defaultMs: '30000', factory: createInventorySkewRebalancerTick },
  { id: 'kalman-filter-tracker', name: 'Kalman Filter Tracker', envKey: 'KALMAN_FILTER_INTERVAL_MS', defaultMs: '8000', factory: createKalmanFilterTrackerTick },
  { id: 'liquidity-vacuum', name: 'Liquidity Vacuum', envKey: 'LIQUIDITY_VACUUM_INTERVAL_MS', defaultMs: '5000', factory: createLiquidityVacuumTick },
  { id: 'twap-accumulator', name: 'TWAP Accumulator', envKey: 'TWAP_ACCUMULATOR_INTERVAL_MS', defaultMs: '30000', factory: createTwapAccumulatorTick },
  { id: 'correlation-breakdown', name: 'Correlation Breakdown', envKey: 'CORRELATION_BREAKDOWN_INTERVAL_MS', defaultMs: '15000', factory: createCorrelationBreakdownTick },
  { id: 'entropy-scorer', name: 'Entropy Scorer', envKey: 'ENTROPY_SCORER_INTERVAL_MS', defaultMs: '10000', factory: createEntropyScorerTick },
  { id: 'adverse-selection-filter', name: 'Adverse Selection Filter', envKey: 'ADVERSE_SELECTION_INTERVAL_MS', defaultMs: '10000', factory: createAdverseSelectionFilterTick },
  { id: 'momentum-exhaustion', name: 'Momentum Exhaustion', envKey: 'MOMENTUM_EXHAUSTION_INTERVAL_MS', defaultMs: '10000', factory: createMomentumExhaustionTick },
  { id: 'cross-platform-basis', name: 'Cross-Platform Basis', envKey: 'CROSS_PLATFORM_BASIS_INTERVAL_MS', defaultMs: '15000', factory: createCrossPlatformBasisTick },
];

/**
 * Wire all strategy factories into a new StrategyOrchestrator.
 * Strategies without required deps are silently skipped.
 */
export function wireStrategies(deps: WireStrategyDeps): StrategyOrchestrator {
  const { eventBus, scanner, orderManager, cexExecutor, cexClient, clobClient, gammaClient } = deps;
  const orc = new StrategyOrchestrator(eventBus);

  // Polymarket Arb (needs scanner + orderManager)
  if (scanner && orderManager) {
    orc.register(
      { id: 'polymarket-arb', name: 'Polymarket Arbitrage', type: 'polymarket-arb', enabled: true, params: {}, intervalMs: parseInt(env('POLYMARKET_ARB_INTERVAL_MS', '30000'), 10) },
      createPolymarketArbTick({ scanner, orderManager, eventBus }),
    );
  }

  // All Polymarket strategies (need clobClient + orderManager + gammaClient)
  if (clobClient && orderManager && gammaClient) {
    const polyDeps = { clob: clobClient, orderManager, eventBus, gamma: gammaClient };
    for (const s of POLY_STRATEGIES) {
      orc.register(
        { id: s.id, name: s.name, type: s.id, enabled: false, params: {}, intervalMs: parseInt(env(s.envKey, s.defaultMs), 10) },
        s.factory(polyDeps),
      );
    }
  }

  // Grid/DCA (needs CEX executor + client)
  if (cexExecutor && cexClient) {
    orc.register(
      { id: 'grid-dca', name: 'Grid / DCA', type: 'grid', enabled: false, params: {}, intervalMs: parseInt(env('GRID_DCA_INTERVAL_MS', '60000'), 10) },
      createGridDcaTick({
        executor: cexExecutor, client: cexClient, eventBus,
        params: {
          exchange: 'binance',
          symbol:      env('GRID_SYMBOL', 'BTC/USDT'),
          gridSpacing: parseFloat(env('GRID_SPACING', '0.01')),
          numLevels:   parseInt(env('GRID_LEVELS', '5'), 10),
          orderSize:   parseFloat(env('GRID_ORDER_SIZE', '0.001')),
        },
      }),
    );
  }

  return orc;
}

/**
 * Wire strategies AND start the NATS event loop when a messaging transport is configured.
 */
export async function wireStrategiesWithNats(
  deps: WireStrategyDeps,
): Promise<{ orc: StrategyOrchestrator; eventLoop: NatsEventLoop }> {
  const orc = wireStrategies(deps);
  const eventLoop = await startNatsEventLoop();
  return { orc, eventLoop };
}

/** @deprecated Use wireStrategies() */
export function wirePolymarketStrategies(deps: PolymarketDeps): StrategyOrchestrator { return wireStrategies(deps); }
/** @deprecated Use wireStrategies() */
export function wireCexDexStrategies(deps: CexDexDeps): StrategyOrchestrator { return wireStrategies(deps); }
/** @deprecated Use wireStrategies() */
export function wireAllStrategies(deps: AllStrategyDeps): StrategyOrchestrator { return wireStrategies(deps); }
