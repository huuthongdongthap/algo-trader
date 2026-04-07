/**
 * LLM Configuration for M1 Max 64GB
 *
 * Dual bare-metal MLX servers (mlx_lm.server, NOT Ollama):
 *   DeepSeek R1 :11435 — deep reasoning (~10 tok/s, 90s timeout)
 *   Nemotron Nano :11436 — fast triage (~45 tok/s, 10s timeout)
 *
 * Fallback chain: MLX primary → Ollama → Claude cloud
 * Fast triage: Nemotron → MLX primary → Ollama → Claude cloud
 */

export interface LlmEndpoint {
  url: string;
  model: string;
  priority: number;
  maxTokens: number;
  timeoutMs: number;
}

export interface LlmConfig {
  primary: LlmEndpoint;
  fastTriage: LlmEndpoint;
  fallback: LlmEndpoint;
  cloud?: LlmEndpoint;
  healthCheckIntervalMs: number;
  cloudDailyBudgetUsd: number;
}

export function loadLlmConfig(): LlmConfig {
  return {
    primary: {
      url: process.env.LLM_PRIMARY_URL || 'http://127.0.0.1:11435/v1',
      model: process.env.LLM_PRIMARY_MODEL || 'mlx-community/DeepSeek-R1-Distill-Qwen-32B-4bit',
      priority: 1,
      maxTokens: 2048,
      timeoutMs: 90000,
    },
    fastTriage: {
      url: process.env.LLM_FAST_TRIAGE_URL || 'http://127.0.0.1:11436/v1',
      model: process.env.LLM_FAST_TRIAGE_MODEL || 'mlx-community/NVIDIA-Nemotron-3-Nano-30B-A3B-4bit',
      priority: 1,
      maxTokens: 512,
      timeoutMs: 10000,
    },
    fallback: {
      url: process.env.LLM_FALLBACK_URL || 'http://127.0.0.1:11434/v1',
      model: process.env.LLM_FALLBACK_MODEL || 'deepseek-r1:32b',
      priority: 2,
      maxTokens: 2048,
      timeoutMs: 30000,
    },
    cloud: process.env.CLAUDE_API_KEY ? {
      url: process.env.LLM_CLOUD_URL || 'https://api.anthropic.com/v1',
      model: process.env.LLM_CLOUD_MODEL || 'claude-sonnet-4-20250514',
      priority: 3,
      maxTokens: 4096,
      timeoutMs: 60000,
    } : undefined,
    healthCheckIntervalMs: 30000,
    cloudDailyBudgetUsd: Number(process.env.LLM_CLOUD_DAILY_BUDGET) || 100,
  };
}
