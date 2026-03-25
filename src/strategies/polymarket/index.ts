// Barrel export for Polymarket strategies
export { CrossMarketArbStrategy } from './cross-market-arb.js';
export type { ArbConfig } from './cross-market-arb.js';

export { MarketMakerStrategy } from './market-maker.js';
export type { MMConfig } from './market-maker.js';

export { MomentumScalperStrategy } from './momentum-scalper.js';
export type { MomentumConfig } from './momentum-scalper.js';

export { createBookImbalanceReversalTick } from './book-imbalance-reversal.js';
export type { BookImbalanceConfig, BookImbalanceDeps } from './book-imbalance-reversal.js';

export { createVwapDeviationSniperTick } from './vwap-deviation-sniper.js';
export type { VwapDeviationConfig, VwapDeviationDeps } from './vwap-deviation-sniper.js';

export { createPairsStatArbTick } from './pairs-stat-arb.js';
export type { PairsStatArbConfig, PairsStatArbDeps } from './pairs-stat-arb.js';

export { createSessionVolSniperTick } from './session-vol-sniper.js';
export type { SessionVolSniperConfig, SessionVolSniperDeps } from './session-vol-sniper.js';

export { createRegimeAdaptiveMomentumTick } from './regime-adaptive-momentum.js';
export type { RegimeAdaptiveConfig, RegimeAdaptiveDeps } from './regime-adaptive-momentum.js';
