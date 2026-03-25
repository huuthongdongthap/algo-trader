// Prediction Loop — orchestrates long-tail market scanning → LLM probability estimation → signal ranking
// Logs each prediction to SQLite (ai_decisions table). NO order execution — paper validation only.

import { MarketScanner, type ScanOptions, type MarketOpportunity } from './market-scanner.js';
import { PredictionProbabilityEstimator, type PredictionSignal } from '../openclaw/prediction-probability-estimator.js';
import { EnsembleEstimator } from '../openclaw/ensemble-estimator.js';
import { TemperatureScaler } from '../openclaw/temperature-scaler.js';
import { getDecisionLogger } from '../openclaw/decision-logger.js';
import { logger } from '../core/logger.js';

export interface PredictionLoopOptions {
  /** Scan options forwarded to MarketScanner (long-tail defaults applied) */
  scanOptions?: ScanOptions;
  /** Minimum |edge| to include signal in output (default: 0.05) */
  minEdge?: number;
  /** Max markets to estimate per cycle (guards against excessive LLM calls) */
  maxEstimates?: number;
  /** SQLite db path */
  dbPath?: string;
  /** Interval in milliseconds between loop cycles (default: 15 min) */
  intervalMs?: number;
  /** Enable ensemble voting (N=3, default: true) */
  useEnsemble?: boolean;
  /** Enable temperature scaling (default: true, identity until fitted) */
  useTemperatureScaling?: boolean;
}

export interface RankedSignal extends PredictionSignal {
  description: string;
  rank: number;
  yesTokenId: string;
  noTokenId: string;
}

// Long-tail event-only defaults: exclude price markets where LLM has no edge
// Research-backed: 7-30d resolution = sweet spot for info arrival + LLM edge
// Volume <$100K = less arb-saturated (HFT report finding)
const DEFAULT_SCAN_OPTIONS: ScanOptions = {
  minVolume: 1_000,
  maxVolume: 100_000,
  minResolutionDays: 7,
  maxResolutionDays: 30,
  limit: 50,
  excludePriceMarkets: true,
};

const DEFAULT_MIN_EDGE = 0.05;
const DEFAULT_MAX_ESTIMATES = 20;
const DEFAULT_INTERVAL_MS = 15 * 60 * 1_000; // 15 minutes

export class PredictionLoop {
  private readonly scanner: MarketScanner;
  private readonly estimator: PredictionProbabilityEstimator;
  private readonly ensemble: EnsembleEstimator | null;
  private readonly scaler: TemperatureScaler;
  private readonly opts: Required<Omit<PredictionLoopOptions, 'scanOptions' | 'useEnsemble' | 'useTemperatureScaling'>> & { scanOptions: ScanOptions; useEnsemble: boolean; useTemperatureScaling: boolean };
  private cycleCount = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(scanner: MarketScanner, estimator?: PredictionProbabilityEstimator, opts: PredictionLoopOptions = {}) {
    this.scanner = scanner;
    this.estimator = estimator ?? new PredictionProbabilityEstimator();
    const useEnsemble = opts.useEnsemble ?? true;
    this.ensemble = useEnsemble ? new EnsembleEstimator(this.estimator) : null;
    this.scaler = new TemperatureScaler();
    this.opts = {
      scanOptions: { ...DEFAULT_SCAN_OPTIONS, ...opts.scanOptions },
      minEdge: opts.minEdge ?? DEFAULT_MIN_EDGE,
      maxEstimates: opts.maxEstimates ?? DEFAULT_MAX_ESTIMATES,
      dbPath: opts.dbPath ?? 'data/algo-trade.db',
      intervalMs: opts.intervalMs ?? DEFAULT_INTERVAL_MS,
      useEnsemble,
      useTemperatureScaling: opts.useTemperatureScaling ?? true,
    };
    logger.info(`PredictionLoop v2.0: ensemble=${useEnsemble}, tempScaling=${this.opts.useTemperatureScaling}`, 'PredictionLoop');
  }

  /** Access temperature scaler for external fitting (e.g., from CalibrationTuner) */
  getScaler(): TemperatureScaler { return this.scaler; }

  /**
   * Run a single prediction cycle.
   * Returns signals ranked by absolute edge (descending).
   */
  async runCycle(): Promise<RankedSignal[]> {
    this.cycleCount++;
    logger.info(`Prediction cycle #${this.cycleCount} started`, 'PredictionLoop');

    // Step 1: scan long-tail markets
    const result = await this.scanner.scan(this.opts.scanOptions);
    const markets = result.opportunities.slice(0, this.opts.maxEstimates);

    if (markets.length === 0) {
      logger.info('No long-tail markets found this cycle', 'PredictionLoop');
      return [];
    }

    logger.info(`Estimating probabilities for ${markets.length} markets`, 'PredictionLoop');

    // Step 2: estimate probability for each market (sequential to avoid hammering LLM)
    const signals: RankedSignal[] = [];
    for (const market of markets) {
      const signal = await this.estimateAndLog(market);
      if (signal && Math.abs(signal.edge) >= this.opts.minEdge && signal.direction !== 'skip') {
        signals.push({ ...signal, description: market.description, rank: 0, yesTokenId: market.yesTokenId, noTokenId: market.noTokenId });
      }
    }

    // Step 3: rank by absolute edge descending
    signals.sort((a, b) => Math.abs(b.edge) - Math.abs(a.edge));
    signals.forEach((s, i) => { s.rank = i + 1; });

    logger.info(`Cycle #${this.cycleCount} complete`, 'PredictionLoop', {
      scanned: markets.length,
      signals: signals.length,
    });

    return signals;
  }

  /**
   * Start the loop on a recurring interval.
   * Returns a stop function to halt the loop.
   */
  start(onCycle?: (signals: RankedSignal[]) => void): () => void {
    const tick = async () => {
      try {
        const signals = await this.runCycle();
        await onCycle?.(signals);
      } catch (err) {
        logger.error('Prediction cycle error', 'PredictionLoop', { err: String(err) });
      }
      // Always schedule next tick — bot must never stop
      this.timer = setTimeout(tick, this.opts.intervalMs);
    };

    // Run immediately then schedule
    void tick();

    return () => {
      if (this.timer) clearTimeout(this.timer);
      this.timer = null;
      logger.info('Prediction loop stopped', 'PredictionLoop');
    };
  }

  // ── Private ──────────────────────────────────────────────────────────────────

  private async estimateAndLog(market: MarketOpportunity): Promise<PredictionSignal | null> {
    try {
      const input = {
        marketId: market.conditionId,
        question: market.description,
        yesPrice: market.yesMidPrice,
      };

      // v2.0: Use ensemble if available, otherwise single estimate
      let signal = this.ensemble
        ? await this.ensemble.estimate(input)
        : await this.estimator.estimate(input);

      // v2.0: Apply temperature scaling (identity until fitted)
      if (this.opts.useTemperatureScaling) {
        const rawProb = signal.ourProb;
        signal = {
          ...signal,
          ourProb: this.scaler.scale(rawProb),
          edge: this.scaler.scale(rawProb) - input.yesPrice,
        };
        // Recompute direction after scaling
        if (signal.edge > 0.05) signal.direction = 'buy_yes';
        else if (signal.edge < -0.05) signal.direction = 'buy_no';
        else signal.direction = 'skip';
      }

      // Persist to ai_decisions table
      const decisionLogger = getDecisionLogger(this.opts.dbPath);
      decisionLogger.logDecision({
        id: `pred_${market.conditionId}_${Date.now()}`,
        timestamp: Date.now(),
        type: 'analysis',
        input: `market:${market.conditionId} yesPrice:${market.yesMidPrice.toFixed(3)}`,
        output: `ourProb:${signal.ourProb.toFixed(3)} edge:${signal.edge.toFixed(3)} dir:${signal.direction}`,
        model: signal.model,
        tokensUsed: 0, // not tracked per-call in AiRouter response
        latencyMs: signal.latencyMs,
        applied: signal.direction !== 'skip',
        confidence: signal.confidence,
      });

      return signal;
    } catch (err) {
      logger.warn('Estimation failed', 'PredictionLoop', {
        conditionId: market.conditionId,
        err: String(err),
      });
      return null;
    }
  }
}
