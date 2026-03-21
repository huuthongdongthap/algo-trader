// Barrel export for strategy optimizer module
export type { ParamRange } from './grid-search.js';
export { generateGrid, generateRandomSample } from './grid-search.js';

export type { FitnessWeights } from './fitness-scorer.js';
export { DEFAULT_WEIGHTS, calculateFitness } from './fitness-scorer.js';

export type { OptimizerConfig, OptimizationResult, ParamResult } from './optimizer.js';
export { optimize } from './optimizer.js';
