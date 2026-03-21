// OpenClaw AI Gateway configuration
// Routes trading tasks to AI models based on complexity tier

export interface OpenClawRouting {
  /** Model for quick checks: price lookups, basic pattern recognition */
  simple: string;
  /** Model for trade analysis, performance review */
  standard: string;
  /** Model for strategy optimization, risk assessment */
  complex: string;
}

export interface OpenClawConfig {
  /** OpenAI-compatible gateway base URL */
  gatewayUrl: string;
  /** Optional API key for gateway authentication */
  apiKey?: string;
  /** Routing config: maps complexity tier → model ID */
  routing: OpenClawRouting;
  /** Request timeout in milliseconds */
  timeout: number;
}

const DEFAULT_ROUTING: OpenClawRouting = {
  simple: 'llama3.1:8b',
  standard: 'deepseek-r1:32b',
  complex: 'deepseek-r1:70b',
};

const DEFAULT_CONFIG: OpenClawConfig = {
  gatewayUrl: 'http://localhost:11434/v1',
  routing: DEFAULT_ROUTING,
  timeout: 60_000,
};

/**
 * Load OpenClaw config from environment variables.
 * Falls back to defaults for any unset values.
 *
 * Env vars:
 *   OPENCLAW_GATEWAY_URL   - gateway base URL
 *   OPENCLAW_API_KEY       - optional bearer token
 *   OPENCLAW_MODEL_SIMPLE  - model for simple tasks
 *   OPENCLAW_MODEL_STANDARD - model for standard tasks
 *   OPENCLAW_MODEL_COMPLEX - model for complex tasks
 *   OPENCLAW_TIMEOUT_MS    - request timeout (ms)
 */
export function loadOpenClawConfig(): OpenClawConfig {
  const routing: OpenClawRouting = {
    simple: process.env['OPENCLAW_MODEL_SIMPLE'] ?? DEFAULT_ROUTING.simple,
    standard: process.env['OPENCLAW_MODEL_STANDARD'] ?? DEFAULT_ROUTING.standard,
    complex: process.env['OPENCLAW_MODEL_COMPLEX'] ?? DEFAULT_ROUTING.complex,
  };

  const timeoutRaw = process.env['OPENCLAW_TIMEOUT_MS'];
  const timeout = timeoutRaw ? parseInt(timeoutRaw, 10) : DEFAULT_CONFIG.timeout;

  const config: OpenClawConfig = {
    gatewayUrl: process.env['OPENCLAW_GATEWAY_URL'] ?? DEFAULT_CONFIG.gatewayUrl,
    routing,
    timeout: isNaN(timeout) ? DEFAULT_CONFIG.timeout : timeout,
  };

  const apiKey = process.env['OPENCLAW_API_KEY'];
  if (apiKey) {
    config.apiKey = apiKey;
  }

  return config;
}
