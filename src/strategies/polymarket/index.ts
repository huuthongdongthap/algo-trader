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

export { createOrderbookDepthRatioTick } from './orderbook-depth-ratio.js';
export type { OrderbookDepthConfig, OrderbookDepthDeps } from './orderbook-depth-ratio.js';

export { createCrossEventDriftTick } from './cross-event-drift.js';
export type { CrossEventDriftConfig, CrossEventDriftDeps } from './cross-event-drift.js';

export { createVolCompressionBreakoutTick } from './vol-compression-breakout.js';
export type { VolCompressionConfig, VolCompressionDeps } from './vol-compression-breakout.js';

export { createWhaleTrackerTick } from './whale-tracker.js';
export type { WhaleTrackerConfig, WhaleTrackerDeps } from './whale-tracker.js';

export { createResolutionFrontrunnerTick } from './resolution-frontrunner.js';
export type { ResolutionFrontrunnerConfig, ResolutionFrontrunnerDeps } from './resolution-frontrunner.js';

export { createMultiLegHedgeTick } from './multi-leg-hedge.js';
export type { MultiLegHedgeConfig, MultiLegHedgeDeps } from './multi-leg-hedge.js';

export { createRegimeAdaptiveMomentumTick } from './regime-adaptive-momentum.js';
export type { RegimeAdaptiveMomentumConfig, RegimeAdaptiveMomentumDeps } from './regime-adaptive-momentum.js';

export { createLiquidationCascadeTick } from './liquidation-cascade.js';
export type { LiquidationCascadeConfig, LiquidationCascadeDeps } from './liquidation-cascade.js';

export { createOrderFlowToxicityTick } from './order-flow-toxicity.js';
export type { OrderFlowToxicityConfig, OrderFlowToxicityDeps } from './order-flow-toxicity.js';

export { createGammaScalpingTick } from './gamma-scalping.js';
export type { GammaScalpingConfig, GammaScalpingDeps } from './gamma-scalping.js';
