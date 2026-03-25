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
  /** OpenAI-compatible gateway base URL (DeepSeek — deep reasoner) */
  gatewayUrl: string;
  /** Nemotron fast-scanner URL (separate MLX server instance) */
  scannerUrl: string;
  /** Optional API key for gateway authentication */
  apiKey?: string;
  /** Routing config: maps complexity tier → model ID */
  routing: OpenClawRouting;
  /** Request timeout in milliseconds */
  timeout: number;
}

const DEFAULT_ROUTING: OpenClawRouting = {
  // Nemotron-3 Nano: fast scanner (35-50 t/s), function calling, 1M context
  simple: 'mlx-community/NVIDIA-Nemotron-3-Nano-30B-A3B-4bit',
  // DeepSeek R1: balanced reasoning for trade analysis
  standard: 'mlx-community/DeepSeek-R1-Distill-Qwen-32B-4bit',
  // DeepSeek R1: deep chain-of-thought for strategy optimization
  complex: 'mlx-community/DeepSeek-R1-Distill-Qwen-32B-4bit',
};

const DEFAULT_CONFIG: OpenClawConfig = {
  gatewayUrl: 'http://192.168.11.111:11435/v1',
  scannerUrl: 'http://192.168.11.111:11436/v1',
  routing: DEFAULT_ROUTING,
  timeout: 300_000,
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
    scannerUrl: process.env['OPENCLAW_SCANNER_URL'] ?? DEFAULT_CONFIG.scannerUrl,
    routing,
    timeout: isNaN(timeout) ? DEFAULT_CONFIG.timeout : timeout,
  };

  const apiKey = process.env['OPENCLAW_API_KEY'];
  if (apiKey) {
    config.apiKey = apiKey;
  }

  return config;
}
