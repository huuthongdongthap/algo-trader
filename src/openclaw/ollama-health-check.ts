// Ollama LLM gateway health check and model discovery
// Verifies Ollama is running and lists available models for OpenClaw routing

import { logger } from '../core/logger.js';

export interface OllamaModel {
  name: string;
  size: number;
  parameterSize: string;
}

export interface OllamaHealthResult {
  healthy: boolean;
  url: string;
  models: OllamaModel[];
  latencyMs: number;
  error?: string;
}

/**
 * Check if Ollama is running and list available models.
 * Uses Ollama's native /api/tags endpoint for model listing.
 */
export async function checkOllamaHealth(baseUrl = 'http://localhost:11434'): Promise<OllamaHealthResult> {
  const start = Date.now();
  try {
    // Check Ollama is alive
    const healthRes = await fetch(`${baseUrl}/api/tags`, {
      signal: AbortSignal.timeout(5_000),
    });

    if (!healthRes.ok) {
      return { healthy: false, url: baseUrl, models: [], latencyMs: Date.now() - start, error: `HTTP ${healthRes.status}` };
    }

    const data = (await healthRes.json()) as { models?: Array<{ name: string; size: number; details?: { parameter_size?: string } }> };
    const models: OllamaModel[] = (data.models ?? []).map(m => ({
      name: m.name,
      size: m.size,
      parameterSize: m.details?.parameter_size ?? 'unknown',
    }));

    const latencyMs = Date.now() - start;
    logger.info('Ollama health check passed', 'OllamaGateway', { models: models.length, latencyMs });

    return { healthy: true, url: baseUrl, models, latencyMs };
  } catch (err) {
    const latencyMs = Date.now() - start;
    const error = err instanceof Error ? err.message : String(err);
    logger.warn('Ollama health check failed', 'OllamaGateway', { error, latencyMs });
    return { healthy: false, url: baseUrl, models: [], latencyMs, error };
  }
}

/**
 * Auto-select best available models for each complexity tier.
 * Prefers larger models for complex tasks, smaller for simple.
 */
export function autoSelectModels(models: OllamaModel[]): { simple: string; standard: string; complex: string } {
  const names = models.map(m => m.name);

  // Priority lists for each tier
  const complexPrefs = ['deepseek-r1:70b', 'qwen2.5:72b', 'llama3.1:70b', 'mixtral:8x22b', 'deepseek-r1:32b', 'qwen2.5:32b', 'llama3.1:8b'];
  const standardPrefs = ['deepseek-r1:32b', 'qwen2.5:32b', 'llama3.1:8b', 'mistral:7b', 'gemma2:9b', 'deepseek-r1:14b'];
  const simplePrefs = ['qwen2.5:7b', 'llama3.2:3b', 'gemma2:2b', 'phi3:mini', 'mistral:7b', 'llama3.1:8b'];

  const pick = (prefs: string[]): string => {
    for (const p of prefs) {
      if (names.some(n => n.startsWith(p.split(':')[0]!))) {
        return names.find(n => n.startsWith(p.split(':')[0]!))!;
      }
    }
    return names[0] ?? 'llama3.1:8b';
  };

  return {
    simple: pick(simplePrefs),
    standard: pick(standardPrefs),
    complex: pick(complexPrefs),
  };
}
