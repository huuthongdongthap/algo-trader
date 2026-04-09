/**
 * Gas Batch Optimizer
 * Collects pending trades in a time window, then flushes as a batch to reduce gas costs.
 *
 * Flow:
 *   addTrade(trade) → queued in pendingBatch[]
 *   After BATCH_WINDOW_MS or MAX_BATCH_SIZE reached → flushBatch() called
 *   If batch execution fails → fall back to individual execution per trade
 *
 * For Polymarket CLOB: batching means submitting multiple orders in one API call
 * (the CLOB API accepts an array of signed orders).
 */

import { logger } from '../utils/logger';

/** A single trade to be batched */
export interface PendingTrade {
  id: string;
  tokenId: string;
  side: 'BUY' | 'SELL';
  price: number;
  size: number;
  /** Optional metadata passed through to result */
  meta?: Record<string, unknown>;
}

/** Result for one trade after batch (or individual) execution */
export interface TradeResult {
  tradeId: string;
  success: boolean;
  orderId?: string;
  error?: string;
  executedViaBatch: boolean;
}

/** Callback to execute a batch of trades — injected by caller */
export type BatchExecutor = (trades: PendingTrade[]) => Promise<TradeResult[]>;

/** Callback to execute a single trade (fallback) */
export type SingleExecutor = (trade: PendingTrade) => Promise<TradeResult>;

export interface BatchOptimizerConfig {
  /** Milliseconds to wait before flushing (default: 5000) */
  windowMs?: number;
  /** Max trades per batch before forcing flush (default: 10) */
  maxBatchSize?: number;
}

/**
 * Batches trades within a configurable time window to minimise gas / API calls.
 * Thread-safe: uses a single flush lock flag to prevent double-flush.
 */
export class GasBatchOptimizer {
  private readonly windowMs: number;
  private readonly maxBatchSize: number;
  private readonly batchExecutor: BatchExecutor;
  private readonly singleExecutor: SingleExecutor;

  private pendingBatch: PendingTrade[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private isFlushing = false;

  /** Resolve callbacks keyed by trade ID, awaited by addTrade() callers */
  private resolvers = new Map<string, (result: TradeResult) => void>();

  constructor(
    batchExecutor: BatchExecutor,
    singleExecutor: SingleExecutor,
    config: BatchOptimizerConfig = {}
  ) {
    this.windowMs = config.windowMs ?? 5_000;
    this.maxBatchSize = config.maxBatchSize ?? 10;
    this.batchExecutor = batchExecutor;
    this.singleExecutor = singleExecutor;
  }

  /**
   * Add a trade to the batch queue and await its execution result.
   * Returns when the batch containing this trade has been executed.
   */
  addTrade(trade: PendingTrade): Promise<TradeResult> {
    return new Promise((resolve) => {
      this.resolvers.set(trade.id, resolve);
      this.pendingBatch.push(trade);

      logger.debug('[GasBatchOptimizer] Trade queued', {
        tradeId: trade.id,
        queueSize: this.pendingBatch.length,
      });

      if (this.pendingBatch.length >= this.maxBatchSize) {
        // Max size reached — flush immediately
        this.scheduleFlush(0);
      } else if (!this.flushTimer) {
        // Start the window timer
        this.scheduleFlush(this.windowMs);
      }
    });
  }

  /** Schedule a flush after `delayMs`. Clears any existing timer. */
  private scheduleFlush(delayMs: number): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
    }
    this.flushTimer = setTimeout(() => this.flushBatch(), delayMs);
  }

  /**
   * Flush pending trades as a batch.
   * Falls back to individual execution if batch executor throws.
   */
  async flushBatch(): Promise<void> {
    if (this.isFlushing || this.pendingBatch.length === 0) return;

    this.isFlushing = true;
    this.flushTimer = null;

    // Drain the queue atomically
    const batch = this.pendingBatch.splice(0, this.pendingBatch.length);

    logger.info('[GasBatchOptimizer] Flushing batch', { count: batch.length });

    try {
      const results = await this.batchExecutor(batch);
      this.resolveResults(results);
    } catch (err) {
      logger.warn('[GasBatchOptimizer] Batch failed — falling back to individual execution', {
        error: err instanceof Error ? err.message : String(err),
        count: batch.length,
      });
      await this.fallbackIndividual(batch);
    } finally {
      this.isFlushing = false;
    }
  }

  /** Execute each trade individually (fallback path) */
  private async fallbackIndividual(trades: PendingTrade[]): Promise<void> {
    const results = await Promise.allSettled(
      trades.map((trade) => this.singleExecutor(trade))
    );

    for (let i = 0; i < trades.length; i++) {
      const trade = trades[i];
      const outcome = results[i];
      const resolver = this.resolvers.get(trade.id);

      if (outcome.status === 'fulfilled') {
        resolver?.(outcome.value);
      } else {
        const errorResult: TradeResult = {
          tradeId: trade.id,
          success: false,
          error: outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason),
          executedViaBatch: false,
        };
        resolver?.(errorResult);
      }

      this.resolvers.delete(trade.id);
    }
  }

  /** Resolve pending promises for each trade result */
  private resolveResults(results: TradeResult[]): void {
    for (const result of results) {
      const resolver = this.resolvers.get(result.tradeId);
      resolver?.(result);
      this.resolvers.delete(result.tradeId);
    }
  }

  /**
   * Force-flush remaining trades and stop the optimizer.
   * Call during graceful shutdown.
   */
  async shutdown(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.pendingBatch.length > 0) {
      await this.flushBatch();
    }
    logger.info('[GasBatchOptimizer] Shutdown complete');
  }

  /** Current number of trades waiting in queue */
  get queueSize(): number {
    return this.pendingBatch.length;
  }
}
