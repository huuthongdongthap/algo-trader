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
import { createRegimeAdaptiveMomentumTick } from '../strategies/polymarket/regime-adaptive-momentum.js';
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
      { id: 'regime-momentum', name: 'Regime-Adaptive Momentum', type: 'regime-momentum', enabled: false, params: {}, intervalMs: parseInt(env('REGIME_MOMENTUM_INTERVAL_MS', '15000'), 10) },
      createRegimeAdaptiveMomentumTick({ clob: clobClient, orderManager, eventBus, gamma: gammaClient }),
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
