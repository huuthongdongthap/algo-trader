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
