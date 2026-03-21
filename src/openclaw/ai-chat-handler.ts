// AI Chat handler: conversational interface for OpenClaw AI
// Supports multi-turn conversation with trading context awareness
// Pro/Enterprise only — free tier gets 0 AI quota

import type { IncomingMessage, ServerResponse } from 'node:http';
import { AiRouter } from './ai-router.js';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatRequest {
  message: string;
  history?: ChatMessage[];
  context?: 'general' | 'strategy' | 'portfolio' | 'market';
}

export interface ChatResponse {
  reply: string;
  model: string;
  tokensUsed: number;
  latencyMs: number;
}

const CONTEXT_PROMPTS: Record<string, string> = {
  general:
    'You are OpenClaw AI, the trading assistant for CashClaw algo-trading platform. ' +
    'Help users understand strategies, explain trading concepts, and provide market analysis. ' +
    'Be concise and actionable. Never give specific financial advice.',
  strategy:
    'You are OpenClaw AI, specialized in algorithmic trading strategy design. ' +
    'Help users configure, optimize, and understand their trading strategies. ' +
    'Explain parameters, backtesting results, and risk management concepts.',
  portfolio:
    'You are OpenClaw AI, focused on portfolio analysis and risk management. ' +
    'Help users understand their portfolio exposure, diversification, and P&L. ' +
    'Provide clear explanations of portfolio metrics.',
  market:
    'You are OpenClaw AI, a market analyst for prediction markets (Polymarket) and crypto. ' +
    'Analyze market conditions, identify trends, and explain market dynamics. ' +
    'Never provide financial advice — only analysis.',
};

function buildConversation(req: ChatRequest): string {
  const parts: string[] = [];

  if (req.history && req.history.length > 0) {
    // Include last 5 turns max for context efficiency
    const recent = req.history.slice(-10);
    for (const msg of recent) {
      parts.push(`${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.content}`);
    }
  }

  parts.push(`User: ${req.message}`);
  parts.push('Assistant:');
  return parts.join('\n\n');
}

export async function handleAiChat(
  body: ChatRequest,
  router: AiRouter,
): Promise<ChatResponse> {
  const context = body.context ?? 'general';
  const systemPrompt = CONTEXT_PROMPTS[context] ?? CONTEXT_PROMPTS.general;
  const prompt = buildConversation(body);

  const hasHistory = body.history && body.history.length > 0;
  const complexity = hasHistory ? 'standard' : 'simple';

  const res = await router.chat({
    prompt,
    systemPrompt,
    complexity,
    maxTokens: 1024,
  });

  return {
    reply: res.content,
    model: res.model,
    tokensUsed: res.tokensUsed,
    latencyMs: res.latencyMs,
  };
}
