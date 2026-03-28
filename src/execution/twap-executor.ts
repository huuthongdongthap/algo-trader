/**
 * TWAP Order Executor
 * Splits large orders into $500-$2K chunks with orderbook depth checks.
 * Aborts if slippage exceeds threshold.
 */

import { logger } from '../utils/logger';

export interface TwapConfig {
  /** Min chunk size in USD (default $500) */
  minChunkUsd: number;
  /** Max chunk size in USD (default $2000) */
  maxChunkUsd: number;
  /** Delay between chunks in ms (default 30s) */
  delayMs: number;
  /** Max slippage % before aborting (default 2%) */
  maxSlippagePercent: number;
  /** Max % of visible depth our chunk can consume (default 2%) */
  maxDepthPercent: number;
}

export interface TwapOrder {
  marketId: string;
  side: 'buy' | 'sell';
  totalSizeUsd: number;
  chunkSizeUsd?: number;
  delayMs?: number;
  maxSlippagePercent?: number;
}

export interface TwapChunkResult {
  chunkIndex: number;
  sizeUsd: number;
  executedPrice: number;
  arrivalPrice: number;
  slippagePercent: number;
  status: 'filled' | 'partial' | 'failed';
  timestamp: number;
}

export interface TwapResult {
  marketId: string;
  side: 'buy' | 'sell';
  totalSizeUsd: number;
  executedSizeUsd: number;
  chunksPlanned: number;
  chunksExecuted: number;
  averagePrice: number;
  arrivalPrice: number;
  totalSlippagePercent: number;
  aborted: boolean;
  abortReason?: string;
  chunks: TwapChunkResult[];
  startedAt: number;
  completedAt: number;
}

/** Callback to get current orderbook depth (USD) for a market */
export type GetDepthFn = (marketId: string, side: 'buy' | 'sell') => Promise<number>;

/** Callback to execute a single chunk order, returns executed price */
export type ExecuteChunkFn = (marketId: string, side: 'buy' | 'sell', sizeUsd: number) => Promise<{ executedPrice: number; filledUsd: number }>;

/** Callback to get current market price */
export type GetPriceFn = (marketId: string) => Promise<number>;

const DEFAULT_CONFIG: TwapConfig = {
  minChunkUsd: 500,
  maxChunkUsd: 2000,
  delayMs: 30000,
  maxSlippagePercent: 2.0,
  maxDepthPercent: 2.0,
};

export class TwapExecutor {
  private config: TwapConfig;

  constructor(config?: Partial<TwapConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /** Plan chunk sizes for a TWAP order */
  planChunks(totalSizeUsd: number, requestedChunkSize?: number): number[] {
    const chunkSize = Math.max(
      this.config.minChunkUsd,
      Math.min(this.config.maxChunkUsd, requestedChunkSize ?? this.config.maxChunkUsd)
    );

    const chunks: number[] = [];
    let remaining = totalSizeUsd;

    while (remaining > 0) {
      const size = Math.min(chunkSize, remaining);
      // If leftover is too small, merge into last chunk
      if (size < this.config.minChunkUsd && chunks.length > 0) {
        chunks[chunks.length - 1] += size;
        remaining = 0;
      } else {
        chunks.push(size);
        remaining -= size;
      }
    }

    return chunks;
  }

  /** Execute a TWAP order with depth checks and slippage monitoring */
  async execute(
    order: TwapOrder,
    getDepth: GetDepthFn,
    executeChunk: ExecuteChunkFn,
    getPrice: GetPriceFn
  ): Promise<TwapResult> {
    const startedAt = Date.now();
    const delayMs = order.delayMs ?? this.config.delayMs;
    const maxSlippage = order.maxSlippagePercent ?? this.config.maxSlippagePercent;

    // Get arrival price (benchmark)
    const arrivalPrice = await getPrice(order.marketId);
    const chunks = this.planChunks(order.totalSizeUsd, order.chunkSizeUsd);

    const result: TwapResult = {
      marketId: order.marketId, side: order.side,
      totalSizeUsd: order.totalSizeUsd, executedSizeUsd: 0,
      chunksPlanned: chunks.length, chunksExecuted: 0,
      averagePrice: 0, arrivalPrice, totalSlippagePercent: 0,
      aborted: false, chunks: [], startedAt, completedAt: 0,
    };

    let totalCostWeighted = 0;

    for (let i = 0; i < chunks.length; i++) {
      let chunkSize = chunks[i];

      // Check orderbook depth before each chunk
      const depth = await getDepth(order.marketId, order.side);
      if (depth > 0 && chunkSize > depth * (this.config.maxDepthPercent / 100)) {
        const reducedSize = depth * (this.config.maxDepthPercent / 100);
        logger.info(`[TWAP] Chunk ${i + 1} reduced from $${chunkSize.toFixed(0)} to $${reducedSize.toFixed(0)} (depth: $${depth.toFixed(0)})`);
        chunkSize = Math.max(this.config.minChunkUsd, reducedSize);
      }

      try {
        const { executedPrice, filledUsd } = await executeChunk(order.marketId, order.side, chunkSize);

        const slippagePercent = arrivalPrice > 0
          ? Math.abs(executedPrice - arrivalPrice) / arrivalPrice * 100
          : 0;

        const chunkResult: TwapChunkResult = {
          chunkIndex: i, sizeUsd: filledUsd, executedPrice, arrivalPrice,
          slippagePercent, status: filledUsd >= chunkSize * 0.95 ? 'filled' : 'partial',
          timestamp: Date.now(),
        };

        result.chunks.push(chunkResult);
        result.executedSizeUsd += filledUsd;
        result.chunksExecuted++;
        totalCostWeighted += executedPrice * filledUsd;

        // Check slippage threshold — abort if exceeded
        if (slippagePercent > maxSlippage) {
          result.aborted = true;
          result.abortReason = `Slippage ${slippagePercent.toFixed(2)}% exceeds max ${maxSlippage}%`;
          logger.warn(`[TWAP] Aborted: ${result.abortReason}`);
          break;
        }

        logger.info(`[TWAP] Chunk ${i + 1}/${chunks.length}: $${filledUsd.toFixed(0)} @ ${executedPrice.toFixed(4)} (slippage: ${slippagePercent.toFixed(2)}%)`);
      } catch (error) {
        result.chunks.push({
          chunkIndex: i, sizeUsd: 0, executedPrice: 0, arrivalPrice,
          slippagePercent: 0, status: 'failed', timestamp: Date.now(),
        });
        logger.error(`[TWAP] Chunk ${i + 1} failed:`, { error });
      }

      // Delay between chunks (skip after last)
      if (i < chunks.length - 1 && !result.aborted) {
        await new Promise(r => setTimeout(r, delayMs));
      }
    }

    // Calculate final stats
    result.averagePrice = result.executedSizeUsd > 0 ? totalCostWeighted / result.executedSizeUsd : 0;
    result.totalSlippagePercent = arrivalPrice > 0
      ? Math.abs(result.averagePrice - arrivalPrice) / arrivalPrice * 100
      : 0;
    result.completedAt = Date.now();

    logger.info(`[TWAP] Complete: ${result.chunksExecuted}/${result.chunksPlanned} chunks, $${result.executedSizeUsd.toFixed(0)}/$${order.totalSizeUsd.toFixed(0)}, avg slippage ${result.totalSlippagePercent.toFixed(2)}%`);

    return result;
  }

  getConfig(): TwapConfig {
    return { ...this.config };
  }
}
