import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LlmRouter } from '../../src/lib/llm-router.js';

// Mock fetch globally
const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

function makeOkResponse(content: string, tokens = 10) {
  return new Response(JSON.stringify({
    choices: [{ message: { content } }],
    usage: { total_tokens: tokens },
  }), { status: 200 });
}

function makeErrorResponse() {
  return new Response('error', { status: 500 });
}

describe('LlmRouter — fastChat', () => {
  let router: LlmRouter;

  beforeEach(() => {
    fetchMock.mockReset();
    router = new LlmRouter({
      primary: {
        url: 'http://deepseek:11435/v1',
        model: 'deepseek-r1',
        priority: 1,
        maxTokens: 2048,
        timeoutMs: 5000,
      },
      fastTriage: {
        url: 'http://nemotron:11436/v1',
        model: 'nemotron-nano',
        priority: 1,
        maxTokens: 512,
        timeoutMs: 2000,
      },
      fallback: {
        url: 'http://ollama:11434/v1',
        model: 'deepseek-r1:32b',
        priority: 2,
        maxTokens: 2048,
        timeoutMs: 5000,
      },
      healthCheckIntervalMs: 30000,
      cloudDailyBudgetUsd: 100,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('routes fastChat to Nemotron endpoint first', async () => {
    fetchMock.mockResolvedValueOnce(makeOkResponse('fast answer'));

    const result = await router.fastChat({
      messages: [{ role: 'user', content: 'estimate fair value' }],
    });

    expect(result.content).toBe('fast answer');
    expect(result.model).toBe('nemotron-nano');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toContain('nemotron:11436');
  });

  it('falls back to primary (DeepSeek) when Nemotron fails', async () => {
    fetchMock
      .mockResolvedValueOnce(makeErrorResponse())   // Nemotron fails
      .mockResolvedValueOnce(makeOkResponse('deep answer')); // DeepSeek succeeds

    const result = await router.fastChat({
      messages: [{ role: 'user', content: 'test' }],
    });

    expect(result.content).toBe('deep answer');
    expect(result.model).toBe('deepseek-r1');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('emits failover event when Nemotron fails', async () => {
    const failoverSpy = vi.fn();
    router.on('failover', failoverSpy);

    fetchMock
      .mockResolvedValueOnce(makeErrorResponse())
      .mockResolvedValueOnce(makeOkResponse('fallback'));

    await router.fastChat({ messages: [{ role: 'user', content: 'test' }] });

    expect(failoverSpy).toHaveBeenCalledWith({ from: 'mlx-fast', to: 'mlx-primary' });
  });

  it('regular chat() still routes to DeepSeek first', async () => {
    fetchMock.mockResolvedValueOnce(makeOkResponse('deep reasoning'));

    const result = await router.chat({
      messages: [{ role: 'user', content: 'analyze this trade' }],
    });

    expect(result.content).toBe('deep reasoning');
    expect(fetchMock.mock.calls[0][0]).toContain('deepseek:11435');
  });

  it('fastChat falls through full chain if both MLX fail', async () => {
    fetchMock
      .mockResolvedValueOnce(makeErrorResponse())   // Nemotron fails
      .mockResolvedValueOnce(makeErrorResponse())   // DeepSeek fails
      .mockResolvedValueOnce(makeOkResponse('ollama fallback')); // Ollama succeeds

    const result = await router.fastChat({
      messages: [{ role: 'user', content: 'test' }],
    });

    expect(result.content).toBe('ollama fallback');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
