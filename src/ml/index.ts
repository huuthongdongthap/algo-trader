// ML Signal Generator - barrel export
// Pure TypeScript, no external ML libraries

export type { PriceFeatures, PricePoint } from './feature-extractor.js';
export {
  calculateSMA,
  calculateRSI,
  calculateMomentum,
  calculateVolatility,
  calculateMACD,
  extractFeatures,
} from './feature-extractor.js';

export type { SignalScore, ModelWeights } from './signal-model.js';
export { DEFAULT_WEIGHTS, scoreFeatures, trainWeights } from './signal-model.js';

export type { SignalThresholds, SymbolSignal } from './ml-signal-feed.js';
export { MlSignalFeed, DEFAULT_THRESHOLDS } from './ml-signal-feed.js';
