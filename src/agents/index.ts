// Agents barrel export — Mekong-style AgentDispatcher architecture
export { AgentDispatcher } from './agent-dispatcher.js';
export { registerCommand } from './command-registry.js';
export {
  createTask, successResult, failResult,
  type AgentTask, type AgentResult, type SpecialistAgent, type AgentTaskType,
} from './agent-base.js';
export { type CommandDef } from './command-registry.js';

// Specialist agents
export { ScannerAgent } from './scanner-agent.js';
export { MonitorAgent } from './monitor-agent.js';
export { EstimateAgent } from './estimate-agent.js';
export { RiskAgent } from './risk-agent.js';
export { CalibrateAgent } from './calibrate-agent.js';
export { ReportAgent } from './report-agent.js';
export { DoctorAgent } from './doctor-agent.js';

// Dark edge agents (P1)
export { NegRiskScanAgent } from './neg-risk-scan-agent.js';
export { EndgameAgent } from './endgame-agent.js';
export { ResolutionArbAgent } from './resolution-arb-agent.js';
export { WhaleWatchAgent } from './whale-watch-agent.js';

// Dark edge agents (P2)
export { EventClusterAgent } from './event-cluster-agent.js';
export { VolumeAlertAgent } from './volume-alert-agent.js';
export { SplitMergeArbAgent } from './split-merge-arb-agent.js';

// Dark edge agents (P3)
export { NewsSniperAgent } from './news-snipe-agent.js';
export { ContrarianAgent } from './contrarian-agent.js';

// HFT + Admin agents
export { SeedAdminAgent } from './seed-admin-agent.js';
export { WarmModelAgent } from './warm-model-agent.js';
export { HftLoopAgent } from './hft-loop-agent.js';
