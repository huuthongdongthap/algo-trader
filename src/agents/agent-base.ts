// Agent base types — foundation for Mekong-style AgentDispatcher architecture
// All specialist agents implement SpecialistAgent interface

export type AgentTaskType = 'scan' | 'estimate' | 'monitor' | 'risk' | 'calibrate' | 'report' | 'doctor'
  | 'neg-risk-scan' | 'endgame' | 'resolution-arb' | 'whale-watch'
  | 'event-cluster' | 'volume-alert' | 'split-merge-arb';

export interface AgentTask {
  id: string;
  type: AgentTaskType;
  payload: Record<string, unknown>;
  createdAt: number;
}

export interface AgentResult {
  agentName: string;
  taskId: string;
  success: boolean;
  data: unknown;
  error?: string;
  durationMs: number;
}

export interface SpecialistAgent {
  readonly name: string;
  readonly description: string;
  readonly taskTypes: AgentTaskType[];
  canHandle(task: AgentTask): boolean;
  execute(task: AgentTask): Promise<AgentResult>;
}

let taskCounter = 0;

/** Create a new AgentTask with auto-generated ID */
export function createTask(type: AgentTaskType, payload: Record<string, unknown> = {}): AgentTask {
  taskCounter++;
  return {
    id: `task-${Date.now()}-${taskCounter}`,
    type,
    payload,
    createdAt: Date.now(),
  };
}

/** Helper to build a successful AgentResult */
export function successResult(agentName: string, taskId: string, data: unknown, durationMs: number): AgentResult {
  return { agentName, taskId, success: true, data, durationMs };
}

/** Helper to build a failed AgentResult */
export function failResult(agentName: string, taskId: string, error: string, durationMs: number): AgentResult {
  return { agentName, taskId, success: false, data: null, error, durationMs };
}
