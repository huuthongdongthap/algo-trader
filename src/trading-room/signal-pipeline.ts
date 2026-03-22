// SignalPipeline: Signal → Validate → Risk-check → Execute → Confirm
// Processes trading signals through ordered stages with monitoring hooks

import type { OrderSide, MarketType } from '../core/types.js';
import type { TradeExecutor, TradeRequest } from '../engine/trade-executor.js';
import { logger } from '../core/logger.js';

/** A raw signal entering the pipeline from any strategy or AI source */
export interface TradingSignal {
  id: string;
  source: string;          // strategy name or 'ai-router'
  symbol: string;
  side: OrderSide;
  /** 0-1: how confident the source is in this signal */
  confidence: number;
  /** Suggested notional size (decimal string) */
  size?: string;
  timestamp: number;
  meta?: Record<string, unknown>;
}

/** Processing stages a signal passes through */
export type PipelineStage = 'signal' | 'validate' | 'risk-check' | 'execute' | 'confirm';

/** Full lifecycle record for one signal */
export interface PipelineRecord {
  signal: TradingSignal;
  stage: PipelineStage;
  startedAt: number;
  completedAt?: number;
  error?: string;
  /** Stage-level notes (e.g. rejection reason, fill price) */
  notes: string[];
}

type StageCallback = (record: PipelineRecord) => void;

/** Minimum confidence threshold to pass validation */
const MIN_CONFIDENCE = 0.5;

/**
 * SignalPipeline: processes TradingSignals through five ordered stages.
 * Callbacks registered via onStageComplete fire after each stage transition.
 */
export class SignalPipeline {
  /** Signals currently being processed */
  private active: Map<string, PipelineRecord> = new Map();
  /** Completed / rejected signal history (capped at 200) */
  private history: PipelineRecord[] = [];
  private stageCallbacks: StageCallback[] = [];
  private executor: TradeExecutor | null = null;
  private dryRun = true;

  /** Inject TradeExecutor for real order submission */
  setExecutor(executor: TradeExecutor, dryRun = true): void {
    this.executor = executor;
    this.dryRun = dryRun;
  }

  /** Register a monitoring hook — called after every stage transition */
  onStageComplete(cb: StageCallback): void {
    this.stageCallbacks.push(cb);
  }

  /** Enter a new signal into the pipeline (non-blocking) */
  addSignal(signal: TradingSignal): void {
    if (this.active.has(signal.id)) {
      logger.warn(`Signal ${signal.id} already in pipeline`, 'SignalPipeline');
      return;
    }
    const record: PipelineRecord = {
      signal,
      stage: 'signal',
      startedAt: Date.now(),
      notes: [],
    };
    this.active.set(signal.id, record);
    logger.info(`Signal received: ${signal.symbol} ${signal.side} (${signal.source})`, 'SignalPipeline');
    // Process asynchronously — do not await here to keep addSignal non-blocking
    this.processSignal(signal).catch(err => {
      logger.error(`Pipeline error for ${signal.id}: ${err}`, 'SignalPipeline');
    });
  }

  /**
   * Run signal through all five stages sequentially.
   * Any rejection or error stops further processing.
   */
  async processSignal(signal: TradingSignal): Promise<void> {
    const record = this.active.get(signal.id);
    if (!record) return;

    try {
      // Stage 1: validate
      await this.runStage(record, 'validate', () => this.stageValidate(record));
      // Stage 2: risk-check
      await this.runStage(record, 'risk-check', () => this.stageRiskCheck(record));
      // Stage 3: execute
      await this.runStage(record, 'execute', () => this.stageExecute(record));
      // Stage 4: confirm
      await this.runStage(record, 'confirm', () => this.stageConfirm(record));

      record.completedAt = Date.now();
      logger.info(`Signal complete: ${signal.symbol} ${signal.side}`, 'SignalPipeline');
    } catch (err) {
      record.error = err instanceof Error ? err.message : String(err);
      record.completedAt = Date.now();
      logger.warn(`Signal rejected at ${record.stage}: ${record.error}`, 'SignalPipeline');
    } finally {
      this.active.delete(signal.id);
      this.archiveRecord(record);
    }
  }

  /** Return signals currently in flight */
  getActivePipeline(): PipelineRecord[] {
    return [...this.active.values()];
  }

  /** Return recent completed signals */
  getHistory(limit = 50): PipelineRecord[] {
    return this.history.slice(-limit);
  }

  // ---- Private stage implementations ----------------------------------------

  private async runStage(
    record: PipelineRecord,
    stage: PipelineStage,
    fn: () => Promise<void>,
  ): Promise<void> {
    record.stage = stage;
    await fn();
    this.fireCallbacks(record);
  }

  /** Validate: check symbol format, side, confidence floor */
  private async stageValidate(record: PipelineRecord): Promise<void> {
    const { signal } = record;
    if (!signal.symbol || !signal.side) {
      throw new Error('Missing symbol or side');
    }
    if (signal.confidence < MIN_CONFIDENCE) {
      throw new Error(`Confidence ${signal.confidence} below threshold ${MIN_CONFIDENCE}`);
    }
    record.notes.push(`validated: confidence=${signal.confidence}`);
  }

  /**
   * Risk-check: placeholder — in production, delegates to RiskManager.
   * Rejects signals with implausibly large sizes (> 100k notional).
   */
  private async stageRiskCheck(record: PipelineRecord): Promise<void> {
    const size = parseFloat(record.signal.size ?? '0');
    if (size > 100_000) {
      throw new Error(`Size ${size} exceeds risk limit`);
    }
    record.notes.push(`risk-ok: size=${size}`);
  }

  /**
   * Execute: routes signal to TradeExecutor if available, otherwise simulates.
   */
  private async stageExecute(record: PipelineRecord): Promise<void> {
    const { signal } = record;
    if (this.executor) {
      const marketType: MarketType = (signal.meta?.['marketType'] as MarketType) ?? 'cex';
      const exchange = (signal.meta?.['exchange'] as string) ?? 'default';
      const request: TradeRequest = {
        marketType,
        exchange,
        symbol: signal.symbol,
        side: signal.side,
        size: signal.size ?? '0.001',
        strategy: (signal.source ?? 'pipeline') as TradeRequest['strategy'],
        dryRun: this.dryRun,
      };
      const result = await this.executor.execute(request);
      record.notes.push(`executed: ${result.orderId} fill=${result.fillPrice}x${result.fillSize}`);
    } else {
      await new Promise(r => setTimeout(r, 5));
      record.notes.push(`executed: ${signal.side} ${signal.symbol} (no executor)`);
    }
    logger.debug(`Executed signal ${signal.id}`, 'SignalPipeline');
  }

  /** Confirm: mark the order as acknowledged */
  private async stageConfirm(record: PipelineRecord): Promise<void> {
    record.notes.push('confirmed');
  }

  private fireCallbacks(record: PipelineRecord): void {
    for (const cb of this.stageCallbacks) {
      try { cb(record); } catch { /* swallow callback errors */ }
    }
  }

  private archiveRecord(record: PipelineRecord): void {
    this.history.push(record);
    if (this.history.length > 200) this.history.shift();
  }
}
