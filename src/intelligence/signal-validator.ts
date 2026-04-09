/**
 * Signal Validator
 * Sends arbitrage signal candidates to DeepSeek (OpenAI-compatible) for AI validation.
 * Acts as the "vũ khí bí mật" gate — every signal must pass AI review before execution.
 *
 * Flow:
 *   buildValidationPrompt() → callDeepSeekValidation() → parseValidationResponse()
 *   Retry on transient errors, return ValidationResult with valid/confidence/reasoning/risks
 */

import { loadLlmConfig } from '../config/llm-config';
import { logger } from '../utils/logger';

export interface SignalCandidate {
  /** Strategy type that generated this signal */
  signalType: 'simple-arb' | 'cross-market' | 'delta-neutral';
  /** Markets involved in the trade */
  markets: Array<{
    id: string;
    title: string;
    yesPrice: number;
    noPrice: number;
  }>;
  /** Expected edge as a fraction (e.g. 0.05 = 5%) */
  expectedEdge: number;
  /** Human-readable reasoning from the strategy */
  reasoning: string;
}

export interface ValidationResult {
  /** Whether DeepSeek considers the signal a valid opportunity */
  valid: boolean;
  /** Confidence score 0–1 */
  confidence: number;
  /** AI explanation of the decision */
  reasoning: string;
  /** Identified risk factors (empty array if none) */
  risks: string[];
}

const RETRY_LIMIT = 2;
const RETRY_DELAY_MS = 1_500;

const VALIDATION_SYSTEM_PROMPT = `You are a Polymarket arbitrage signal validator. Your job is to confirm or reject trade signals before execution.

Respond ONLY with a valid JSON object. No markdown, no code blocks, no explanation outside JSON.

JSON schema:
{
  "valid": boolean,
  "confidence": number (0.0 to 1.0),
  "reasoning": string (1-3 sentences),
  "risks": string[] (list of risk factors, empty array if none)
}`;

/** Build the user prompt from a signal candidate */
function buildValidationPrompt(signal: SignalCandidate): string {
  const marketLines = signal.markets
    .map(m => `  - ${m.title} (id=${m.id}) YES=${m.yesPrice.toFixed(3)} NO=${m.noPrice.toFixed(3)}`)
    .join('\n');

  return `Validate this Polymarket arbitrage signal:

Signal type: ${signal.signalType}
Expected edge: ${(signal.expectedEdge * 100).toFixed(2)}%
Strategy reasoning: ${signal.reasoning}

Markets involved:
${marketLines}

Is this a valid arbitrage opportunity? Consider:
1. Is the edge real or a data artifact (stale prices, API lag)?
2. Are there liquidity concerns (thin books, wide spreads)?
3. Is there event risk (market resolving soon, binary risk)?
4. Could this be a front-running trap or toxic flow?

Respond with JSON only.`;
}

/** Raw DeepSeek API call — OpenAI-compatible chat completions */
async function callDeepSeekValidation(prompt: string, llmUrl: string, llmModel: string): Promise<string> {
  const body = {
    model: llmModel,
    messages: [
      { role: 'system', content: VALIDATION_SYSTEM_PROMPT },
      { role: 'user', content: prompt },
    ],
    temperature: 0.1,
    max_tokens: 512,
  };

  const resp = await fetch(`${llmUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(90_000),
  });

  if (!resp.ok) {
    throw new Error(`LLM API error: HTTP ${resp.status}`);
  }

  const data = await resp.json() as { choices?: Array<{ message?: { content?: string } }> };
  return data.choices?.[0]?.message?.content ?? '';
}

/** Parse LLM response into typed ValidationResult — graceful fallback on parse errors */
function parseValidationResponse(raw: string): ValidationResult {
  try {
    // Strip markdown code fences if model wraps response
    const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const parsed = JSON.parse(cleaned) as Partial<ValidationResult>;

    return {
      valid: typeof parsed.valid === 'boolean' ? parsed.valid : false,
      confidence: typeof parsed.confidence === 'number'
        ? Math.max(0, Math.min(1, parsed.confidence))
        : 0,
      reasoning: typeof parsed.reasoning === 'string' ? parsed.reasoning : 'Unable to parse AI reasoning',
      risks: Array.isArray(parsed.risks) ? parsed.risks.filter(r => typeof r === 'string') : [],
    };
  } catch (err) {
    logger.warn('[SignalValidator] Failed to parse LLM response', { raw, err });
    return {
      valid: false,
      confidence: 0,
      reasoning: 'AI validation response could not be parsed — signal rejected for safety',
      risks: ['parse-error'],
    };
  }
}

/**
 * Validate a signal candidate using DeepSeek AI.
 * Returns ValidationResult — caller checks `valid && confidence > threshold`.
 */
export async function validateSignal(signal: SignalCandidate): Promise<ValidationResult> {
  const llmConfig = loadLlmConfig();
  const { url: llmUrl, model: llmModel } = llmConfig.primary;
  const prompt = buildValidationPrompt(signal);

  for (let attempt = 1; attempt <= RETRY_LIMIT; attempt++) {
    try {
      logger.debug(`[SignalValidator] Calling LLM attempt ${attempt}/${RETRY_LIMIT}`, {
        signalType: signal.signalType,
        edge: signal.expectedEdge,
      });

      const raw = await callDeepSeekValidation(prompt, llmUrl, llmModel);
      const result = parseValidationResponse(raw);

      logger.info('[SignalValidator] Validation complete', {
        signalType: signal.signalType,
        valid: result.valid,
        confidence: result.confidence,
        risks: result.risks,
      });

      return result;
    } catch (err) {
      logger.warn(`[SignalValidator] Attempt ${attempt}/${RETRY_LIMIT} failed`, { err });
      if (attempt < RETRY_LIMIT) {
        await new Promise(r => setTimeout(r, RETRY_DELAY_MS * attempt));
      }
    }
  }

  // All attempts exhausted — fail closed (reject signal)
  logger.error('[SignalValidator] All LLM attempts failed — rejecting signal for safety', {
    signalType: signal.signalType,
  });
  return {
    valid: false,
    confidence: 0,
    reasoning: 'AI validation service unavailable after retries — signal rejected for safety',
    risks: ['llm-unavailable'],
  };
}
