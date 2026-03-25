import { describe, it, expect } from 'vitest';
import { LiveModeGuard } from '../../src/polymarket/live-mode-guard.js';
import { RiskManager } from '../../src/core/risk-manager.js';
import type { DailyRecord } from '../../src/core/capital-tiers.js';

function makeRiskManager() {
  return new RiskManager({
    maxPositionSize: '500',
    maxDrawdown: 0.20,
    maxOpenPositions: 10,
    stopLossPercent: 0.10,
    maxLeverage: 1,
  });
}

function makeDays(count: number, profitable: number): DailyRecord[] {
  return Array.from({ length: count }, (_, i) => ({
    date: `2026-01-${String(i + 1).padStart(2, '0')}`,
    pnl: i < profitable ? 15 : -5,
  }));
}

describe('LiveModeGuard', () => {
  describe('paper mode', () => {
    it('always allows trades in paper mode', () => {
      const guard = new LiveModeGuard(makeRiskManager(), {
        capital: 200,
        dailyRecords: [],
        paperTrading: true,
      });
      const result = guard.check('1000', []);
      expect(result.allowed).toBe(true);
      expect(result.reason).toContain('Paper');
    });
  });

  describe('live mode — tier validation', () => {
    it('blocks when insufficient dry-run days', () => {
      const guard = new LiveModeGuard(makeRiskManager(), {
        capital: 200,
        dailyRecords: makeDays(5, 5),
        paperTrading: false,
      });
      const result = guard.check('50', []);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('dry-run days');
    });

    it('blocks when insufficient profitable days', () => {
      const guard = new LiveModeGuard(makeRiskManager(), {
        capital: 200,
        dailyRecords: makeDays(14, 5),
        paperTrading: false,
      });
      const result = guard.check('50', []);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('profitable days');
    });

    it('allows when tier requirements met', () => {
      const guard = new LiveModeGuard(makeRiskManager(), {
        capital: 200,
        dailyRecords: makeDays(14, 12),
        paperTrading: false,
      });
      const result = guard.check('10', []);
      expect(result.allowed).toBe(true);
    });
  });

  describe('live mode — risk manager delegation', () => {
    it('blocks when circuit breaker tripped', () => {
      const rm = makeRiskManager();
      rm.recordTradeResult(false);
      rm.recordTradeResult(false);
      rm.recordTradeResult(false);

      const guard = new LiveModeGuard(rm, {
        capital: 200,
        dailyRecords: makeDays(14, 12),
        paperTrading: false,
      });
      const result = guard.check('10', []);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Circuit breaker');
    });

    it('blocks when position exceeds 10% of capital', () => {
      const guard = new LiveModeGuard(makeRiskManager(), {
        capital: 200,
        dailyRecords: makeDays(14, 12),
        paperTrading: false,
      });
      const result = guard.check('25', []); // 12.5% of $200
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('10%');
    });
  });

  describe('updateCapital', () => {
    it('updates internal capital', () => {
      const guard = new LiveModeGuard(makeRiskManager(), {
        capital: 200,
        dailyRecords: makeDays(14, 12),
        paperTrading: false,
      });
      guard.updateCapital(500);
      // Now tier 2 — needs 14 fresh days, but still has tier 1 records
      // This check should still pass since capital 500 = tier 2 but records have 14 days
      const result = guard.check('10', []);
      expect(result.allowed).toBe(true);
    });
  });
});
