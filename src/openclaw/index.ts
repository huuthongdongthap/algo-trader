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
