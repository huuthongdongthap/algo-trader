// OpenClaw module barrel export
// AI routing controller for algo-trade platform

export { OpenClawController } from './controller.js';
export type { TradeAnalysis, StrategyEvaluation, ParameterSuggestion, PerformanceReport } from './controller.js';

export { AiRouter } from './ai-router.js';
export type { TaskComplexity, AiRequest, AiResponse } from './ai-router.js';

export { loadOpenClawConfig } from './openclaw-config.js';
export type { OpenClawConfig, OpenClawRouting } from './openclaw-config.js';

export { computeConsensus, isActionable, DEFAULT_CONSENSUS_CONFIG } from './signal-consensus.js';
export type { ConsensusResult, ConsensusConfig, ConsensusVerdict } from './signal-consensus.js';

export { selectStrategies } from './ai-strategy-selector.js';
export type { MarketConditions, StrategyRecommendation } from './ai-strategy-selector.js';

export { adjustRisk, riskLimitsToParams } from './ai-risk-adjuster.js';
export type { RiskParams, AdjustedRiskParams } from './ai-risk-adjuster.js';

export { reviewTrade } from './ai-trade-reviewer.js';
export type { CompletedTrade, TradeReview } from './ai-trade-reviewer.js';
