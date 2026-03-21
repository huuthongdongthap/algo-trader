// Stealth order execution — anti-detection patterns inspired by Binh Pháp
// "Appear where you are not expected" — Sun Tzu, Chapter 6
//
// Ported from: anti-detection-order-randomizer, binh-phap-stealth-trading,
// phantom-order-cloaking concepts.

import type { TradeResult } from '../core/types.js';
import type { TradeRequest } from '../engine/trade-executor.js';
import { TradeExecutor } from '../engine/trade-executor.js';

export interface StealthConfig {
  /** Master switch — disable for testing/dry-run */
  enabled: boolean;
  /** How many chunks to split a large order into (2–10 recommended) */
  sizeSplitCount: number;
  /** Base delay between chunks in ms */
  timingJitterMs: number;
  /** Size randomization percentage (0.05 = ±5%) to avoid round numbers */
  sizeRandomPct: number;
}

export const DEFAULT_STEALTH_CONFIG: StealthConfig = {
  enabled: true,
  sizeSplitCount: 3,
  timingJitterMs: 800,
  sizeRandomPct: 0.04,
};

/**
 * Wraps TradeExecutor with stealth execution layer.
 *
 * Pipeline per order:
 *   1. splitOrder → N random-proportioned chunks (sum = original)
 *   2. randomizeSize → each chunk gets ±sizeRandomPct noise
 *   3. addTimingJitter → random delay before each chunk
 *   4. execute each chunk via underlying TradeExecutor
 */
export class StealthExecutor {
  constructor(
    private readonly executor: TradeExecutor,
    private readonly config: StealthConfig = DEFAULT_STEALTH_CONFIG,
  ) {}

  /**
   * Split totalSize into `count` random-weight chunks.
   * Uses Dirichlet-like approach: assign random weights, normalize to sum = 1.
   */
  splitOrder(totalSize: number, count: number): number[] {
    if (count <= 1) return [totalSize];

    // Generate random weights (uniform [0,1])
    const weights = Array.from({ length: count }, () => Math.random() + 0.1);
    const weightSum = weights.reduce((a, b) => a + b, 0);

    // Normalize weights → proportional sizes
    const chunks = weights.map((w) => (w / weightSum) * totalSize);

    // Correct float drift: adjust last chunk so sum == totalSize
    const assigned = chunks.slice(0, -1).reduce((a, b) => a + b, 0);
    chunks[count - 1] = totalSize - assigned;

    return chunks.map((c) => Math.max(0, c));
  }

  /**
   * Add ±30% jitter to a base delay.
   * Prevents fixed-interval timing fingerprinting.
   */
  addTimingJitter(baseDelayMs: number): number {
    const jitterFactor = 0.7 + Math.random() * 0.6; // [0.7, 1.3]
    return Math.round(baseDelayMs * jitterFactor);
  }

  /**
   * Randomize size by ±pct to avoid round-number detection.
   * e.g. 1000 USDT → 974.23 USDT (pct=0.05)
   */
  randomizeSize(size: number, pct: number): number {
    const noise = 1 + (Math.random() * 2 - 1) * pct; // [1-pct, 1+pct]
    return size * noise;
  }

  /** Async sleep helper */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Execute a trade request with stealth wrapping.
   * Returns array of TradeResults (one per chunk).
   * If stealth disabled → single execution passthrough.
   */
  async execute(request: TradeRequest): Promise<TradeResult[]> {
    if (!this.config.enabled) {
      const result = await this.executor.execute(request);
      return [result];
    }

    const totalSize = parseFloat(request.size);
    const rawChunks = this.splitOrder(totalSize, this.config.sizeSplitCount);

    const results: TradeResult[] = [];

    for (let i = 0; i < rawChunks.length; i++) {
      // Add timing jitter before each chunk (skip first to execute immediately)
      if (i > 0) {
        const delay = this.addTimingJitter(this.config.timingJitterMs);
        await this.sleep(delay);
      }

      // Randomize chunk size to avoid pattern detection
      const stealthSize = this.randomizeSize(rawChunks[i], this.config.sizeRandomPct);

      const chunkRequest: TradeRequest = {
        ...request,
        size: stealthSize.toFixed(6),
      };

      const result = await this.executor.execute(chunkRequest);
      results.push(result);
    }

    return results;
  }
}
