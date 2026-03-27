/**
 * Strategy wiring — registers strategy tick functions with StrategyOrchestrator.
 * Pure orchestration: creates tick factories and wires them into the orchestrator.
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

export interface WireStrategyDeps {
  eventBus: EventBus;
  scanner?: MarketScanner;     // required for polymarket-arb
  orderManager?: OrderManager; // required for polymarket-arb
  cexExecutor?: OrderExecutor; // required for grid-dca
  cexClient?: ExchangeClient;  // required for grid-dca
  clobClient?: ClobClient;     // required for book-imbalance
  gammaClient?: GammaClient;   // required for book-imbalance
}

// Backward-compat type aliases (wiring/index.ts re-exports these by name)
/** @deprecated Use WireStrategyDeps */
export type PolymarketDeps = Pick<WireStrategyDeps, 'eventBus' | 'scanner' | 'orderManager'>;
/** @deprecated Use WireStrategyDeps */
export type CexDexDeps = Pick<WireStrategyDeps, 'eventBus' | 'cexExecutor' | 'cexClient'>;
/** @deprecated Use WireStrategyDeps */
export type AllStrategyDeps = WireStrategyDeps;

const env = (key: string, fallback: string) => process.env[key] ?? fallback;

/**
 * Wire all strategy factories into a new StrategyOrchestrator.
 * Strategies without required deps are silently skipped.
 * Call orchestrator.startAll() after wiring.
 */
export function wireStrategies(deps: WireStrategyDeps): StrategyOrchestrator {
  const { eventBus, scanner, orderManager, cexExecutor, cexClient, clobClient, gammaClient } = deps;
  const orc = new StrategyOrchestrator(eventBus);

  if (scanner && orderManager) {
    orc.register(
      { id: 'polymarket-arb', name: 'Polymarket Arbitrage', type: 'polymarket-arb', enabled: true, params: {}, intervalMs: parseInt(env('POLYMARKET_ARB_INTERVAL_MS', '30000'), 10) },
      createPolymarketArbTick({ scanner, orderManager, eventBus }),
    );
  }

  if (clobClient && orderManager && gammaClient) {
    orc.register(
      { id: 'book-imbalance', name: 'Book Imbalance Reversal', type: 'book-imbalance', enabled: false, params: {}, intervalMs: parseInt(env('BOOK_IMBALANCE_INTERVAL_MS', '15000'), 10) },
      createBookImbalanceReversalTick({ clob: clobClient, orderManager, eventBus, gamma: gammaClient }),
    );
  }

  if (clobClient && orderManager && gammaClient) {
    orc.register(
      { id: 'vwap-sniper', name: 'VWAP Deviation Sniper', type: 'vwap-sniper', enabled: false, params: {}, intervalMs: parseInt(env('VWAP_SNIPER_INTERVAL_MS', '10000'), 10) },
      createVwapDeviationSniperTick({ clob: clobClient, orderManager, eventBus, gamma: gammaClient }),
    );
  }

  if (clobClient && orderManager && gammaClient) {
    orc.register(
      { id: 'pairs-stat-arb', name: 'Pairs Statistical Arbitrage', type: 'pairs-stat-arb', enabled: false, params: {}, intervalMs: parseInt(env('PAIRS_STAT_ARB_INTERVAL_MS', '30000'), 10) },
      createPairsStatArbTick({ clob: clobClient, orderManager, eventBus, gamma: gammaClient }),
    );
  }

  if (clobClient && orderManager && gammaClient) {
    orc.register(
      { id: 'session-vol-sniper', name: 'Session Volatility Sniper', type: 'session-vol-sniper', enabled: false, params: {}, intervalMs: parseInt(env('SESSION_VOL_SNIPER_INTERVAL_MS', '5000'), 10) },
      createSessionVolSniperTick({ clob: clobClient, orderManager, eventBus, gamma: gammaClient }),
    );
  }

  if (clobClient && orderManager && gammaClient) {
    orc.register(
      { id: 'orderbook-depth', name: 'Orderbook Depth Ratio', type: 'orderbook-depth', enabled: false, params: {}, intervalMs: parseInt(env('ORDERBOOK_DEPTH_INTERVAL_MS', '10000'), 10) },
      createOrderbookDepthRatioTick({ clob: clobClient, orderManager, eventBus, gamma: gammaClient }),
    );
  }

  if (clobClient && orderManager && gammaClient) {
    orc.register(
      { id: 'cross-event-drift', name: 'Cross-Event Drift Catcher', type: 'cross-event-drift', enabled: false, params: {}, intervalMs: parseInt(env('CROSS_EVENT_DRIFT_INTERVAL_MS', '15000'), 10) },
      createCrossEventDriftTick({ clob: clobClient, orderManager, eventBus, gamma: gammaClient }),
    );
  }

  if (clobClient && orderManager && gammaClient) {
    orc.register(
      { id: 'vol-compression', name: 'Volatility Compression Breakout', type: 'vol-compression', enabled: false, params: {}, intervalMs: parseInt(env('VOL_COMPRESSION_INTERVAL_MS', '8000'), 10) },
      createVolCompressionBreakoutTick({ clob: clobClient, orderManager, eventBus, gamma: gammaClient }),
    );
  }

  if (clobClient && orderManager && gammaClient) {
    orc.register(
      { id: 'whale-tracker', name: 'Whale Tracker', type: 'whale-tracker', enabled: false, params: {}, intervalMs: parseInt(env('WHALE_TRACKER_INTERVAL_MS', '10000'), 10) },
      createWhaleTrackerTick({ clob: clobClient, orderManager, eventBus, gamma: gammaClient }),
    );
  }

  if (clobClient && orderManager && gammaClient) {
    orc.register(
      { id: 'resolution-frontrunner', name: 'Resolution Frontrunner', type: 'resolution-frontrunner', enabled: false, params: {}, intervalMs: parseInt(env('RESOLUTION_FRONTRUNNER_INTERVAL_MS', '30000'), 10) },
      createResolutionFrontrunnerTick({ clob: clobClient, orderManager, eventBus, gamma: gammaClient }),
    );
  }

  if (clobClient && orderManager && gammaClient) {
    orc.register(
      { id: 'multi-leg-hedge', name: 'Multi-Leg Hedge', type: 'multi-leg-hedge', enabled: false, params: {}, intervalMs: parseInt(env('MULTI_LEG_HEDGE_INTERVAL_MS', '20000'), 10) },
      createMultiLegHedgeTick({ clob: clobClient, orderManager, eventBus, gamma: gammaClient }),
    );
  }

  if (clobClient && orderManager && gammaClient) {
    orc.register(
      { id: 'regime-adaptive-momentum', name: 'Regime-Adaptive Momentum', type: 'regime-adaptive-momentum', enabled: false, params: {}, intervalMs: parseInt(env('REGIME_MOMENTUM_INTERVAL_MS', '10000'), 10) },
      createRegimeAdaptiveMomentumTick({ clob: clobClient, orderManager, eventBus, gamma: gammaClient }),
    );
  }

  if (clobClient && orderManager && gammaClient) {
    orc.register(
      { id: 'liquidation-cascade', name: 'Liquidation Cascade', type: 'liquidation-cascade', enabled: false, params: {}, intervalMs: parseInt(env('LIQUIDATION_CASCADE_INTERVAL_MS', '5000'), 10) },
      createLiquidationCascadeTick({ clob: clobClient, orderManager, eventBus, gamma: gammaClient }),
    );
  }

  if (clobClient && orderManager && gammaClient) {
    orc.register(
      { id: 'order-flow-toxicity', name: 'Order Flow Toxicity', type: 'order-flow-toxicity', enabled: false, params: {}, intervalMs: parseInt(env('ORDER_FLOW_TOXICITY_INTERVAL_MS', '8000'), 10) },
      createOrderFlowToxicityTick({ clob: clobClient, orderManager, eventBus, gamma: gammaClient }),
    );
  }

  if (clobClient && orderManager && gammaClient) {
    orc.register(
      { id: 'gamma-scalping', name: 'Gamma Scalping', type: 'gamma-scalping', enabled: false, params: {}, intervalMs: parseInt(env('GAMMA_SCALPING_INTERVAL_MS', '10000'), 10) },
      createGammaScalpingTick({ clob: clobClient, orderManager, eventBus, gamma: gammaClient }),
    );
  }

  if (clobClient && orderManager && gammaClient) {
    orc.register(
      { id: 'funding-rate-arb', name: 'Funding Rate Arbitrage', type: 'funding-rate-arb', enabled: false, params: {}, intervalMs: parseInt(env('FUNDING_RATE_ARB_INTERVAL_MS', '15000'), 10) },
      createFundingRateArbTick({ clob: clobClient, orderManager, eventBus, gamma: gammaClient }),
    );
  }

  if (clobClient && orderManager && gammaClient) {
    orc.register(
      { id: 'expiry-theta-decay', name: 'Expiry Theta Decay', type: 'expiry-theta-decay', enabled: false, params: {}, intervalMs: parseInt(env('EXPIRY_THETA_DECAY_INTERVAL_MS', '20000'), 10) },
      createExpiryThetaDecayTick({ clob: clobClient, orderManager, eventBus, gamma: gammaClient }),
    );
  }

  if (clobClient && orderManager && gammaClient) {
    orc.register(
      { id: 'microstructure-alpha', name: 'Microstructure Alpha', type: 'microstructure-alpha', enabled: false, params: {}, intervalMs: parseInt(env('MICROSTRUCTURE_ALPHA_INTERVAL_MS', '3000'), 10) },
      createMicrostructureAlphaTick({ clob: clobClient, orderManager, eventBus, gamma: gammaClient }),
    );
  }

  if (clobClient && orderManager && gammaClient) {
    orc.register(
      { id: 'sentiment-momentum', name: 'Sentiment Momentum', type: 'sentiment-momentum', enabled: false, params: {}, intervalMs: parseInt(env('SENTIMENT_MOMENTUM_INTERVAL_MS', '10000'), 10) },
      createSentimentMomentumTick({ clob: clobClient, orderManager, eventBus, gamma: gammaClient }),
    );
  }

  if (clobClient && orderManager && gammaClient) {
    orc.register(
      { id: 'smart-money-divergence', name: 'Smart Money Divergence', type: 'smart-money-divergence', enabled: false, params: {}, intervalMs: parseInt(env('SMART_MONEY_DIVERGENCE_INTERVAL_MS', '10000'), 10) },
      createSmartMoneyDivergenceTick({ clob: clobClient, orderManager, eventBus, gamma: gammaClient }),
    );
  }

  if (clobClient && orderManager && gammaClient) {
    orc.register(
      { id: 'volatility-surface-arb', name: 'Volatility Surface Arb', type: 'volatility-surface-arb', enabled: false, params: {}, intervalMs: parseInt(env('VOLATILITY_SURFACE_ARB_INTERVAL_MS', '15000'), 10) },
      createVolatilitySurfaceArbTick({ clob: clobClient, orderManager, eventBus, gamma: gammaClient }),
    );
  }

  if (clobClient && orderManager && gammaClient) {
    orc.register(
      { id: 'news-catalyst-fade', name: 'News Catalyst Fade', type: 'news-catalyst-fade', enabled: false, params: {}, intervalMs: parseInt(env('NEWS_CATALYST_FADE_INTERVAL_MS', '10000'), 10) },
      createNewsCatalystFadeTick({ clob: clobClient, orderManager, eventBus, gamma: gammaClient }),
    );
  }

  if (clobClient && orderManager && gammaClient) {
    orc.register(
      { id: 'inventory-skew-rebalancer', name: 'Inventory Skew Rebalancer', type: 'inventory-skew-rebalancer', enabled: false, params: {}, intervalMs: parseInt(env('INVENTORY_SKEW_INTERVAL_MS', '30000'), 10) },
      createInventorySkewRebalancerTick({ clob: clobClient, orderManager, eventBus, gamma: gammaClient }),
    );
  }

  if (clobClient && orderManager && gammaClient) {
    orc.register(
      { id: 'kalman-filter-tracker', name: 'Kalman Filter Tracker', type: 'kalman-filter-tracker', enabled: false, params: {}, intervalMs: parseInt(env('KALMAN_FILTER_INTERVAL_MS', '8000'), 10) },
      createKalmanFilterTrackerTick({ clob: clobClient, orderManager, eventBus, gamma: gammaClient }),
    );
  }

  if (clobClient && orderManager && gammaClient) {
    orc.register(
      { id: 'liquidity-vacuum', name: 'Liquidity Vacuum', type: 'liquidity-vacuum', enabled: false, params: {}, intervalMs: parseInt(env('LIQUIDITY_VACUUM_INTERVAL_MS', '5000'), 10) },
      createLiquidityVacuumTick({ clob: clobClient, orderManager, eventBus, gamma: gammaClient }),
    );
  }

  if (clobClient && orderManager && gammaClient) {
    orc.register(
      { id: 'twap-accumulator', name: 'TWAP Accumulator', type: 'twap-accumulator', enabled: false, params: {}, intervalMs: parseInt(env('TWAP_ACCUMULATOR_INTERVAL_MS', '30000'), 10) },
      createTwapAccumulatorTick({ clob: clobClient, orderManager, eventBus, gamma: gammaClient }),
    );
  }

  if (clobClient && orderManager && gammaClient) {
    orc.register(
      { id: 'correlation-breakdown', name: 'Correlation Breakdown', type: 'correlation-breakdown', enabled: false, params: {}, intervalMs: parseInt(env('CORRELATION_BREAKDOWN_INTERVAL_MS', '15000'), 10) },
      createCorrelationBreakdownTick({ clob: clobClient, orderManager, eventBus, gamma: gammaClient }),
    );
  }

  if (clobClient && orderManager && gammaClient) {
    orc.register(
      { id: 'entropy-scorer', name: 'Entropy Scorer', type: 'entropy-scorer', enabled: false, params: {}, intervalMs: parseInt(env('ENTROPY_SCORER_INTERVAL_MS', '10000'), 10) },
      createEntropyScorerTick({ clob: clobClient, orderManager, eventBus, gamma: gammaClient }),
    );
  }

  if (clobClient && orderManager && gammaClient) {
    orc.register(
      { id: 'adverse-selection-filter', name: 'Adverse Selection Filter', type: 'adverse-selection-filter', enabled: false, params: {}, intervalMs: parseInt(env('ADVERSE_SELECTION_INTERVAL_MS', '10000'), 10) },
      createAdverseSelectionFilterTick({ clob: clobClient, orderManager, eventBus, gamma: gammaClient }),
    );
  }

  if (clobClient && orderManager && gammaClient) {
    orc.register(
      { id: 'momentum-exhaustion', name: 'Momentum Exhaustion', type: 'momentum-exhaustion', enabled: false, params: {}, intervalMs: parseInt(env('MOMENTUM_EXHAUSTION_INTERVAL_MS', '10000'), 10) },
      createMomentumExhaustionTick({ clob: clobClient, orderManager, eventBus, gamma: gammaClient }),
    );
  }

  if (clobClient && orderManager && gammaClient) {
    orc.register(
      { id: 'cross-platform-basis', name: 'Cross-Platform Basis', type: 'cross-platform-basis', enabled: false, params: {}, intervalMs: parseInt(env('CROSS_PLATFORM_BASIS_INTERVAL_MS', '15000'), 10) },
      createCrossPlatformBasisTick({ clob: clobClient, orderManager, eventBus, gamma: gammaClient }),
    );
  }

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

// Backward-compat function aliases so wiring/index.ts exports remain valid.
/** @deprecated Use wireStrategies() */
export function wirePolymarketStrategies(deps: PolymarketDeps): StrategyOrchestrator { return wireStrategies(deps); }
/** @deprecated Use wireStrategies() */
export function wireCexDexStrategies(deps: CexDexDeps): StrategyOrchestrator { return wireStrategies(deps); }
/** @deprecated Use wireStrategies() */
export function wireAllStrategies(deps: AllStrategyDeps): StrategyOrchestrator { return wireStrategies(deps); }
