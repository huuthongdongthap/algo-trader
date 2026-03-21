// AI Router: routes trading analysis tasks to appropriate models via OpenClaw gateway
// Uses OpenAI-compatible /chat/completions endpoint (native fetch, no SDK)

import { loadOpenClawConfig, type OpenClawConfig } from './openclaw-config.js';

export type TaskComplexity = 'simple' | 'standard' | 'complex';

export interface AiRequest {
  prompt: string;
  systemPrompt?: string;
  complexity: TaskComplexity;
  maxTokens?: number;
}

export interface AiResponse {
  content: string;
  model: string;
  tokensUsed: number;
  latencyMs: number;
}

// Keywords that signal elevated complexity tiers
const COMPLEX_KEYWORDS = [
  'optimize', 'optimization', 'risk assessment', 'algorithm adjustment',
  'parameter tuning', 'strategy evaluation', 'backtest', 'drawdown',
  'sharpe', 'volatility regime', 'rebalance',
];

const SIMPLE_KEYWORDS = [
  'price', 'current', 'what is', 'quick check', 'basic', 'status',
  'ping', 'simple', 'snapshot',
];

// OpenAI-compatible request body shape
interface ChatCompletionRequest {
  model: string;
  messages: Array<{ role: 'system' | 'user'; content: string }>;
  max_tokens?: number;
}

interface ChatCompletionResponse {
  id: string;
  model: string;
  choices: Array<{
    message: { role: string; content: string };
    finish_reason: string;
  }>;
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

export class AiRouter {
  private readonly config: OpenClawConfig;

  constructor(config?: OpenClawConfig) {
    this.config = config ?? loadOpenClawConfig();
  }

  /** Map complexity tier to configured model ID */
  getModel(complexity: TaskComplexity): string {
    return this.config.routing[complexity];
  }

  /**
   * Auto-detect task complexity from prompt text.
   * Checks complex keywords first, then simple; defaults to standard.
   */
  classifyComplexity(task: string): TaskComplexity {
    const lower = task.toLowerCase();

    if (COMPLEX_KEYWORDS.some((kw) => lower.includes(kw))) return 'complex';
    if (SIMPLE_KEYWORDS.some((kw) => lower.includes(kw))) return 'simple';
    return 'standard';
  }

  /** Send a chat completion request to the OpenClaw gateway */
  async chat(request: AiRequest): Promise<AiResponse> {
    const model = this.getModel(request.complexity);
    const url = `${this.config.gatewayUrl}/chat/completions`;

    const messages: ChatCompletionRequest['messages'] = [];
    if (request.systemPrompt) {
      messages.push({ role: 'system', content: request.systemPrompt });
    }
    messages.push({ role: 'user', content: request.prompt });

    const body: ChatCompletionRequest = { model, messages };
    if (request.maxTokens) body.max_tokens = request.maxTokens;

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.config.apiKey) headers['Authorization'] = `Bearer ${this.config.apiKey}`;

    const startMs = Date.now();

    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.config.timeout),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`OpenClaw gateway error ${res.status}: ${errText}`);
    }

    const data = (await res.json()) as ChatCompletionResponse;
    const latencyMs = Date.now() - startMs;

    const content = data.choices[0]?.message?.content ?? '';
    return {
      content,
      model: data.model,
      tokensUsed: data.usage?.total_tokens ?? 0,
      latencyMs,
    };
  }
}
