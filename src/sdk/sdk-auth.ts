/**
 * SDK authentication helpers: config, header builder, and error class.
 * Auth scheme: X-API-Key header (validated against API_SECRET on server).
 */

// ─── Config ───────────────────────────────────────────────────────────────────

export interface SdkConfig {
  /** Base URL of the algo-trade server, e.g. http://localhost:3000 */
  baseUrl: string;
  /** API key matching the server's API_SECRET env var */
  apiKey: string;
  /** Request timeout in milliseconds (default: 10 000) */
  timeout?: number;
}

// ─── Header builder ───────────────────────────────────────────────────────────

/**
 * Build HTTP headers for authenticated requests.
 * Produces X-API-Key + Content-Type headers required by the server.
 */
export function buildHeaders(apiKey: string): Record<string, string> {
  return {
    'X-API-Key': apiKey,
    'Content-Type': 'application/json',
  };
}

// ─── Error class ──────────────────────────────────────────────────────────────

/**
 * Thrown by AlgoTradeClient when the server returns a non-2xx response
 * or a network-level failure occurs.
 */
export class SdkError extends Error {
  /** HTTP status code (0 for network errors) */
  readonly statusCode: number;
  /** API endpoint path that triggered the error */
  readonly endpoint: string;

  constructor(message: string, statusCode: number, endpoint: string) {
    super(message);
    this.name = 'SdkError';
    this.statusCode = statusCode;
    this.endpoint = endpoint;
    // Maintain proper prototype chain for instanceof checks
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
