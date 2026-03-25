// WarmModelAgent — pre-heat DeepSeek R1 to eliminate cold-start latency
// Sends a trivial prompt to force model load into GPU VRAM
// Usage: algo warm-model [--url <llm-url>]

import type { AgentTask, AgentResult, SpecialistAgent, AgentTaskType } from './agent-base.js';
import { successResult, failResult } from './agent-base.js';

export class WarmModelAgent implements SpecialistAgent {
  readonly name = 'warm-model';
  readonly description = 'Pre-heat DeepSeek R1 model to eliminate cold-start latency';
  readonly taskTypes: AgentTaskType[] = ['warm-model'];

  canHandle(task: AgentTask): boolean {
    return task.type === 'warm-model';
  }

  async execute(task: AgentTask): Promise<AgentResult> {
    const start = Date.now();
    const gatewayUrl = (task.payload['url'] as string) || process.env['OPENCLAW_GATEWAY_URL'] || 'http://localhost:11435/v1';
    const model = process.env['OPENCLAW_MODEL_STANDARD'] || 'mlx-community/DeepSeek-R1-Distill-Qwen-32B-4bit';

    try {
      // Send minimal prompt to force model load
      const res = await fetch(`${gatewayUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: 'ping' }],
          max_tokens: 4,
        }),
        signal: AbortSignal.timeout(120_000),
      });

      if (!res.ok) {
        const errText = await res.text();
        return failResult(this.name, task.id, `LLM gateway ${res.status}: ${errText}`, Date.now() - start);
      }

      const data = await res.json() as { model?: string; usage?: { total_tokens?: number } };
      const latencyMs = Date.now() - start;

      return successResult(this.name, task.id, {
        status: 'warm',
        model: data.model || model,
        gatewayUrl,
        warmupLatencyMs: latencyMs,
        tokensUsed: data.usage?.total_tokens ?? 0,
      }, latencyMs);
    } catch (err) {
      return failResult(this.name, task.id, `Failed to warm model: ${String(err)}`, Date.now() - start);
    }
  }
}
