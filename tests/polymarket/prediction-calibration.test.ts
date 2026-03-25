import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TemperatureScaler } from '../../src/openclaw/temperature-scaler.js';
import { EnsembleEstimator } from '../../src/openclaw/ensemble-estimator.js';
import { PredictionProbabilityEstimator, type PredictionInput, type PredictionSignal } from '../../src/openclaw/prediction-probability-estimator.js';
import { CalibrationTuner } from '../../src/openclaw/calibration-tuner.js';

// ── Mock decision-logger (prevent real SQLite) ──────────────────────────────
const mockLogDecision = vi.fn();
vi.mock('../../src/openclaw/decision-logger.js', () => ({
  getDecisionLogger: () => ({
    logDecision: mockLogDecision,
    getRecentDecisions: vi.fn().mockReturnValue([]),
    close: vi.fn(),
  }),
}));

// ── Mock decision-store (prevent real SQLite) ────────────────────────────────
vi.mock('../../src/openclaw/decision-store.js', () => ({
  initDecisionStore: () => ({
    saveDecision: vi.fn(),
    queryDecisions: vi.fn().mockReturnValue([]),
    getDecisionStats: vi.fn().mockReturnValue({ total: 0, byType: {}, avgConfidence: 0, avgLatency: 0 }),
    close: vi.fn(),
  }),
}));

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeMockEstimator(probSequence: number[]): PredictionProbabilityEstimator {
  let callIndex = 0;
  const estimator = {
    estimate: vi.fn().mockImplementation(async (input: PredictionInput): Promise<PredictionSignal> => {
      const prob = probSequence[callIndex % probSequence.length];
      callIndex++;
      const edge = prob - input.yesPrice;
      return {
        marketId: input.marketId,
        ourProb: prob,
        marketProb: input.yesPrice,
        edge,
        direction: edge > 0.05 ? 'buy_yes' : edge < -0.05 ? 'buy_no' : 'skip',
        confidence: 0.7,
        reasoning: `Mock estimate ${callIndex}`,
        model: 'mock-model',
        latencyMs: 50,
      };
    }),
  } as unknown as PredictionProbabilityEstimator;
  return estimator;
}

const sampleInput: PredictionInput = {
  marketId: 'mkt-abc',
  question: 'Will X happen by end of March?',
  yesPrice: 0.50,
};

// ─────────────────────────────────────────────────────────────────────────────
// 1. Ensemble voting (N=3)
// ─────────────────────────────────────────────────────────────────────────────
describe('EnsembleEstimator', () => {
  it('calls the underlying estimator N=3 times by default', async () => {
    const estimator = makeMockEstimator([0.7, 0.65, 0.75]);
    const ensemble = new EnsembleEstimator(estimator);

    await ensemble.estimate(sampleInput);

    expect(estimator.estimate).toHaveBeenCalledTimes(3);
  });

  it('returns the median probability from 3 calls', async () => {
    // Probabilities: 0.30, 0.50, 0.70 → median = 0.50
    const estimator = makeMockEstimator([0.30, 0.50, 0.70]);
    const ensemble = new EnsembleEstimator(estimator);

    const signal = await ensemble.estimate(sampleInput);

    expect(signal.ourProb).toBe(0.50);
  });

  it('uses median even with outlier estimate', async () => {
    // Probabilities: 0.60, 0.62, 0.99 → sorted [0.60, 0.62, 0.99] → median = 0.62
    const estimator = makeMockEstimator([0.60, 0.62, 0.99]);
    const ensemble = new EnsembleEstimator(estimator);

    const signal = await ensemble.estimate(sampleInput);

    expect(signal.ourProb).toBe(0.62);
  });

  it('computes edge as medianProb - yesPrice', async () => {
    const estimator = makeMockEstimator([0.80, 0.80, 0.80]);
    const ensemble = new EnsembleEstimator(estimator);

    const signal = await ensemble.estimate({ ...sampleInput, yesPrice: 0.50 });

    expect(signal.edge).toBeCloseTo(0.30, 2);
    expect(signal.direction).toBe('buy_yes');
  });

  it('returns skip when all estimates fail', async () => {
    const estimator = {
      estimate: vi.fn().mockRejectedValue(new Error('LLM down')),
    } as unknown as PredictionProbabilityEstimator;
    const ensemble = new EnsembleEstimator(estimator);

    const signal = await ensemble.estimate(sampleInput);

    expect(signal.direction).toBe('skip');
    expect(signal.ourProb).toBe(0.5);
    expect(signal.confidence).toBe(0);
    expect(signal.model).toBe('ensemble-failed');
  });

  it('boosts confidence when agreement is high', async () => {
    // Three very close estimates → high agreement → boosted confidence
    const estimator = makeMockEstimator([0.70, 0.71, 0.70]);
    const ensemble = new EnsembleEstimator(estimator);

    const signal = await ensemble.estimate(sampleInput);

    // avgConfidence = 0.7, boosted by 1.1 → 0.77
    expect(signal.confidence).toBeGreaterThan(0.7);
  });

  it('penalizes confidence when agreement is low', async () => {
    // Wide disagreement: 0.20, 0.50, 0.80 → maxDev = 0.30
    const estimator = makeMockEstimator([0.20, 0.50, 0.80]);
    const ensemble = new EnsembleEstimator(estimator);

    const signal = await ensemble.estimate(sampleInput);

    expect(signal.confidence).toBeLessThan(0.7);
  });

  it('supports configurable N', async () => {
    const estimator = makeMockEstimator([0.60, 0.65, 0.70, 0.75, 0.80]);
    const ensemble = new EnsembleEstimator(estimator, {
      n: 5,
      temperatures: [0.1, 0.2, 0.3, 0.4, 0.5],
    });

    await ensemble.estimate(sampleInput);

    expect(estimator.estimate).toHaveBeenCalledTimes(5);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. TemperatureScaler
// ─────────────────────────────────────────────────────────────────────────────
describe('TemperatureScaler', () => {
  describe('identity (unfitted, T=1.0)', () => {
    it('defaults to a=1.0, b=0.0, fittedOn=0', () => {
      const scaler = new TemperatureScaler();
      const params = scaler.getParams();
      expect(params.a).toBe(1.0);
      expect(params.b).toBe(0.0);
      expect(params.fittedOn).toBe(0);
    });

    it('isFitted returns false when unfitted', () => {
      const scaler = new TemperatureScaler();
      expect(scaler.isFitted()).toBe(false);
    });

    it('scale is near-identity with default params', () => {
      const scaler = new TemperatureScaler();
      // With a=1, b=0: sigmoid(logit(p)) ≈ p
      const testProbs = [0.1, 0.25, 0.5, 0.75, 0.9];
      for (const p of testProbs) {
        expect(scaler.scale(p)).toBeCloseTo(p, 2);
      }
    });

    it('clamps extreme values to [0.01, 0.99]', () => {
      const scaler = new TemperatureScaler();
      expect(scaler.scale(0.001)).toBeGreaterThanOrEqual(0.01);
      expect(scaler.scale(0.999)).toBeLessThanOrEqual(0.99);
    });
  });

  describe('fit', () => {
    it('requires minimum 20 samples', () => {
      const scaler = new TemperatureScaler();
      const result = scaler.fit(
        Array(19).fill(0.6),
        Array(19).fill(1),
      );
      expect(result).toBe(false);
      expect(scaler.isFitted()).toBe(false);
    });

    it('fits on well-calibrated data and stays near identity', () => {
      const scaler = new TemperatureScaler();
      // Generate perfectly calibrated data: predictions ≈ outcomes
      const predictions: number[] = [];
      const outcomes: number[] = [];
      for (let i = 0; i < 50; i++) {
        const p = 0.1 + (i / 50) * 0.8; // 0.1 to 0.9
        predictions.push(p);
        outcomes.push(p > 0.5 ? 1 : 0); // rough calibration
      }

      const result = scaler.fit(predictions, outcomes);

      expect(result).toBe(true);
      expect(scaler.isFitted()).toBe(true);
      const params = scaler.getParams();
      expect(params.fittedOn).toBe(50);
    });

    it('adjusts params for overconfident predictions', () => {
      const scaler = new TemperatureScaler();
      // Overconfident: predict high (0.85-0.95) but outcomes ~50%
      const predictions: number[] = [];
      const outcomes: number[] = [];
      for (let i = 0; i < 30; i++) {
        predictions.push(0.85 + Math.random() * 0.1);
        outcomes.push(i % 2); // 50% actual rate
      }

      scaler.fit(predictions, outcomes);

      // After fitting, scaling high raw prob should pull it toward center
      const scaled = scaler.scale(0.90);
      expect(scaled).toBeLessThan(0.90);
    });

    it('returns false when predictions and outcomes have different lengths', () => {
      const scaler = new TemperatureScaler();
      const result = scaler.fit(
        Array(25).fill(0.6),
        Array(20).fill(1),
      );
      expect(result).toBe(false);
    });
  });

  describe('scale with known params', () => {
    it('shrinks probabilities when a < 1 (overconfidence correction)', () => {
      // a=0.5 compresses logit → pushes toward 0.5
      const scaler = new TemperatureScaler({ a: 0.5, b: 0.0 });
      expect(scaler.scale(0.9)).toBeLessThan(0.9);
      expect(scaler.scale(0.1)).toBeGreaterThan(0.1);
    });

    it('shifts probabilities with nonzero b', () => {
      // b=1.0 shifts logit upward → increases all probabilities
      const scaler = new TemperatureScaler({ a: 1.0, b: 1.0 });
      expect(scaler.scale(0.5)).toBeGreaterThan(0.5);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Edge calculation
// ─────────────────────────────────────────────────────────────────────────────
describe('Edge calculation', () => {
  it('edge = ourProb - marketPrice', async () => {
    const estimator = makeMockEstimator([0.70]);
    const signal = await estimator.estimate({
      marketId: 'mkt-1',
      question: 'Test?',
      yesPrice: 0.50,
    });

    expect(signal.edge).toBeCloseTo(0.20, 2);
  });

  it('positive edge → buy_yes', async () => {
    const estimator = makeMockEstimator([0.80]);
    const signal = await estimator.estimate({ ...sampleInput, yesPrice: 0.50 });
    expect(signal.direction).toBe('buy_yes');
  });

  it('negative edge → buy_no', async () => {
    const estimator = makeMockEstimator([0.30]);
    const signal = await estimator.estimate({ ...sampleInput, yesPrice: 0.50 });
    expect(signal.direction).toBe('buy_no');
  });

  it('near-zero edge → skip', async () => {
    const estimator = makeMockEstimator([0.52]);
    const signal = await estimator.estimate({ ...sampleInput, yesPrice: 0.50 });
    expect(signal.direction).toBe('skip');
  });

  it('ensemble edge uses median vs yesPrice', async () => {
    const estimator = makeMockEstimator([0.60, 0.65, 0.70]);
    const ensemble = new EnsembleEstimator(estimator);
    const signal = await ensemble.estimate({ ...sampleInput, yesPrice: 0.40 });

    // median = 0.65, edge = 0.65 - 0.40 = 0.25
    expect(signal.edge).toBeCloseTo(0.25, 2);
    expect(signal.direction).toBe('buy_yes');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Decision logging (mocked)
// ─────────────────────────────────────────────────────────────────────────────
describe('Decision logging to ai_decisions', () => {
  beforeEach(() => {
    mockLogDecision.mockClear();
  });

  it('PredictionLoop logs decisions with all required fields', async () => {
    // Dynamically import PredictionLoop after mocks are set up
    const { PredictionLoop } = await import('../../src/polymarket/prediction-loop.js');

    const mockScanner = {
      scan: vi.fn().mockResolvedValue({
        scannedAt: Date.now(),
        totalMarkets: 1,
        activeMarkets: 1,
        opportunities: [{
          conditionId: 'cond-123',
          questionId: 'q-123',
          description: 'Will it rain tomorrow?',
          yesMidPrice: 0.45,
          yesTokenId: 'yes-tok',
          noTokenId: 'no-tok',
          volume: 50000,
        }],
      }),
    };

    const mockEstimatorForLoop = makeMockEstimator([0.70]);
    const loop = new PredictionLoop(mockScanner as any, mockEstimatorForLoop, {
      useEnsemble: false,
      useTemperatureScaling: false,
      maxEstimates: 1,
      dbPath: ':memory:',
    });

    await loop.runCycle();

    expect(mockLogDecision).toHaveBeenCalledTimes(1);
    const logged = mockLogDecision.mock.calls[0][0];

    // Verify all required AiDecision fields
    expect(logged).toHaveProperty('id');
    expect(logged.id).toMatch(/^pred_cond-123_/);
    expect(logged).toHaveProperty('timestamp');
    expect(typeof logged.timestamp).toBe('number');
    expect(logged.type).toBe('analysis');
    expect(logged).toHaveProperty('input');
    expect(logged.input).toContain('market:cond-123');
    expect(logged.input).toContain('yesPrice:0.450');
    expect(logged).toHaveProperty('output');
    expect(logged.output).toContain('ourProb:');
    expect(logged.output).toContain('edge:');
    expect(logged.output).toContain('dir:');
    expect(logged).toHaveProperty('model');
    expect(logged).toHaveProperty('tokensUsed');
    expect(logged).toHaveProperty('latencyMs');
    expect(logged).toHaveProperty('applied');
    expect(logged).toHaveProperty('confidence');
    expect(typeof logged.confidence).toBe('number');
  });

  it('logs applied=true when direction is not skip', async () => {
    const { PredictionLoop } = await import('../../src/polymarket/prediction-loop.js');

    const mockScanner = {
      scan: vi.fn().mockResolvedValue({
        scannedAt: Date.now(),
        totalMarkets: 1,
        activeMarkets: 1,
        opportunities: [{
          conditionId: 'cond-456',
          questionId: 'q-456',
          description: 'Big edge market?',
          yesMidPrice: 0.30,
          yesTokenId: 'yes-tok',
          noTokenId: 'no-tok',
          volume: 10000,
        }],
      }),
    };

    // 0.80 vs 0.30 = edge 0.50 → buy_yes → applied=true
    const estimator = makeMockEstimator([0.80]);
    const loop = new PredictionLoop(mockScanner as any, estimator, {
      useEnsemble: false,
      useTemperatureScaling: false,
      dbPath: ':memory:',
    });

    await loop.runCycle();

    expect(mockLogDecision).toHaveBeenCalled();
    const logged = mockLogDecision.mock.calls[0][0];
    expect(logged.applied).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. CalibrationTuner
// ─────────────────────────────────────────────────────────────────────────────
describe('CalibrationTuner', () => {
  it('produces a calibration report from resolved trades', () => {
    const tuner = new CalibrationTuner();

    // Generate 30 resolved trades
    const trades = [];
    for (let i = 0; i < 30; i++) {
      const prob = 0.1 + (i / 30) * 0.8;
      trades.push({ ourProb: prob, outcome: (prob > 0.5 ? 1 : 0) as 0 | 1 });
    }

    const report = tuner.analyze(trades);

    expect(report.buckets).toHaveLength(5);
    expect(report.buckets[0].range).toBe('0-20%');
    expect(report.buckets[4].range).toBe('80-100%');
    expect(typeof report.brierScore).toBe('number');
    expect(typeof report.overallGap).toBe('number');
    expect(['overconfident', 'underconfident', 'calibrated']).toContain(report.bias);
    expect(report.scalerParams).toHaveProperty('a');
    expect(report.scalerParams).toHaveProperty('b');
    expect(report.scalerParams.fittedOn).toBe(30);
  });

  it('detects overconfident predictions', () => {
    const tuner = new CalibrationTuner();

    // Predict high but outcomes are ~50%
    const trades = Array.from({ length: 30 }, (_, i) => ({
      ourProb: 0.80 + Math.random() * 0.15,
      outcome: (i % 2) as 0 | 1,
    }));

    const report = tuner.analyze(trades);

    expect(report.bias).toBe('overconfident');
    expect(report.recommendation).toContain('overconfident');
  });

  it('fits temperature scaler via analyze', () => {
    const scaler = new TemperatureScaler();
    const tuner = new CalibrationTuner(scaler);

    const trades = Array.from({ length: 30 }, (_, i) => ({
      ourProb: 0.1 + (i / 30) * 0.8,
      outcome: (i > 15 ? 1 : 0) as 0 | 1,
    }));

    tuner.analyze(trades);

    expect(scaler.isFitted()).toBe(true);
    expect(scaler.getParams().fittedOn).toBe(30);
  });

  it('uses shared scaler instance', () => {
    const scaler = new TemperatureScaler();
    const tuner = new CalibrationTuner(scaler);
    expect(tuner.getScaler()).toBe(scaler);
  });
});
