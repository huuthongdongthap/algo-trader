import { describe, it, expect, beforeEach } from 'vitest';
import { TuningHistory, type TuningRecord } from '../../src/openclaw/tuning-history.js';

function makeEntry(overrides: Partial<Omit<TuningRecord, 'id'>> = {}): Omit<TuningRecord, 'id'> {
  return {
    timestamp: Date.now(),
    strategy: 'grid-trading' as any,
    previousParams: { gridSpacing: 0.01 },
    newParams: { gridSpacing: 0.015 },
    reasoning: 'AI suggests wider grid spacing',
    confidence: 0.85,
    mode: 'auto' as any,
    applied: true,
    ...overrides,
  };
}

describe('TuningHistory', () => {
  let history: TuningHistory;

  beforeEach(() => {
    history = new TuningHistory();
  });

  it('should record a tuning entry and return id', () => {
    const id = history.record(makeEntry());
    expect(id).toMatch(/^tune_/);
  });

  it('should retrieve history sorted by timestamp desc', () => {
    history.record(makeEntry({ timestamp: 100 }));
    history.record(makeEntry({ timestamp: 300 }));
    history.record(makeEntry({ timestamp: 200 }));

    const records = history.getHistory();
    expect(records).toHaveLength(3);
    expect(records[0].timestamp).toBe(300);
    expect(records[1].timestamp).toBe(200);
    expect(records[2].timestamp).toBe(100);
  });

  it('should filter history by strategy', () => {
    history.record(makeEntry({ strategy: 'grid-trading' as any }));
    history.record(makeEntry({ strategy: 'dca-bot' as any }));
    history.record(makeEntry({ strategy: 'grid-trading' as any }));

    const gridOnly = history.getHistory('grid-trading' as any);
    expect(gridOnly).toHaveLength(2);
  });

  it('should respect limit parameter', () => {
    for (let i = 0; i < 10; i++) history.record(makeEntry());
    expect(history.getHistory(undefined, 3)).toHaveLength(3);
  });

  it('should compute effectiveness report', () => {
    const id1 = history.record(makeEntry({ applied: true }));
    const id2 = history.record(makeEntry({ applied: true }));
    const id3 = history.record(makeEntry({ applied: false }));

    history.markOutcome(id1, 'improved');
    history.markOutcome(id2, 'degraded');

    const report = history.getEffectiveness();
    expect(report.total).toBe(3);
    expect(report.applied).toBe(2);
    expect(report.withOutcome).toBe(2);
    expect(report.improved).toBe(1);
    expect(report.degraded).toBe(1);
    expect(report.neutral).toBe(0);
    expect(report.improvementRate).toBe(0.5);
  });

  it('should return improvementRate 0 when no outcomes', () => {
    history.record(makeEntry());
    const report = history.getEffectiveness();
    expect(report.improvementRate).toBe(0);
  });

  it('should mark outcome and return true', () => {
    const id = history.record(makeEntry());
    expect(history.markOutcome(id, 'improved')).toBe(true);
    const records = history.getHistory();
    expect(records[0].outcome).toBe('improved');
  });

  it('should return false for unknown id', () => {
    expect(history.markOutcome('nonexistent', 'neutral')).toBe(false);
  });

  it('should count neutral outcomes', () => {
    const id1 = history.record(makeEntry({ applied: true }));
    const id2 = history.record(makeEntry({ applied: true }));
    history.markOutcome(id1, 'neutral');
    history.markOutcome(id2, 'neutral');

    const report = history.getEffectiveness();
    expect(report.neutral).toBe(2);
    expect(report.improvementRate).toBe(0);
  });

  it('should return empty history for fresh instance', () => {
    expect(history.getHistory()).toHaveLength(0);
    const report = history.getEffectiveness();
    expect(report.total).toBe(0);
  });
});
