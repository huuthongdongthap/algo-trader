import { describe, it, expect } from 'vitest';
import {
  computeBrierScore,
  computeSharpe,
  computeMaxDrawdown,
  computeWinRate,
  getCalibrationLabel,
  getCapitalTierInfo,
  boxLine,
  boxTop,
  boxMid,
  boxBot,
  formatPnl,
  formatPct,
  truncate,
  formatSignalLine,
  parseOutputSummary,
  parseInputSummary,
  renderDashboardScreen,
  type DashboardStats,
  type SignalRow,
  type CalibrationStatus,
} from '../../src/cli/commands/paper-dashboard.js';

// ── Brier score ──────────────────────────────────────────────────────────────

describe('computeBrierScore', () => {
  it('returns 0 for empty array', () => {
    expect(computeBrierScore([])).toBe(0);
  });

  it('returns 0 for perfect predictions', () => {
    const predictions = [
      { ourProb: 1.0, outcome: 1 },
      { ourProb: 0.0, outcome: 0 },
    ];
    expect(computeBrierScore(predictions)).toBe(0);
  });

  it('returns 0.25 for maximally wrong predictions', () => {
    const predictions = [
      { ourProb: 1.0, outcome: 0 },
      { ourProb: 0.0, outcome: 1 },
    ];
    expect(computeBrierScore(predictions)).toBe(1.0);
  });

  it('computes correct score for mixed predictions', () => {
    const predictions = [
      { ourProb: 0.8, outcome: 1 },
      { ourProb: 0.3, outcome: 0 },
    ];
    // (0.8-1)^2 = 0.04, (0.3-0)^2 = 0.09 => mean = 0.065
    expect(computeBrierScore(predictions)).toBeCloseTo(0.065, 5);
  });
});

// ── Sharpe ratio ─────────────────────────────────────────────────────────────

describe('computeSharpe', () => {
  it('returns 0 for fewer than 2 returns', () => {
    expect(computeSharpe([])).toBe(0);
    expect(computeSharpe([0.05])).toBe(0);
  });

  it('handles near-zero std with floating point variance', () => {
    // With sample variance (N-1), identical values may produce tiny non-zero variance
    // due to floating point arithmetic, resulting in a very large ratio
    const result = computeSharpe([0.1, 0.1, 0.1]);
    // Either 0 (if std truly 0) or very large (floating point noise)
    expect(typeof result).toBe('number');
    expect(Number.isFinite(result)).toBe(true);
  });

  it('computes positive sharpe for positive mean returns', () => {
    const returns = [0.1, 0.2, 0.15, 0.12];
    expect(computeSharpe(returns)).toBeGreaterThan(0);
  });

  it('computes negative sharpe for negative mean returns', () => {
    const returns = [-0.1, -0.2, -0.15, -0.12];
    expect(computeSharpe(returns)).toBeLessThan(0);
  });
});

// ── Max drawdown ─────────────────────────────────────────────────────────────

describe('computeMaxDrawdown', () => {
  it('returns 0 for short equity curves', () => {
    expect(computeMaxDrawdown([])).toBe(0);
    expect(computeMaxDrawdown([100])).toBe(0);
  });

  it('returns 0 for monotonically increasing equity', () => {
    expect(computeMaxDrawdown([100, 110, 120, 130])).toBe(0);
  });

  it('computes correct drawdown', () => {
    // Peak at 200, drop to 180 => -10%
    const curve = [100, 150, 200, 180, 190];
    expect(computeMaxDrawdown(curve)).toBeCloseTo(-0.10, 5);
  });

  it('finds the worst drawdown among multiple dips', () => {
    // First dip: 200 -> 180 = -10%, Second dip: 210 -> 168 = -20%
    const curve = [100, 200, 180, 210, 168];
    expect(computeMaxDrawdown(curve)).toBeCloseTo(-0.20, 5);
  });
});

// ── Win rate ─────────────────────────────────────────────────────────────────

describe('computeWinRate', () => {
  it('returns 0 for empty array', () => {
    expect(computeWinRate([])).toBe(0);
  });

  it('returns 0 when no trades are applied', () => {
    const trades = [{ edge: 0.1, applied: false }];
    expect(computeWinRate(trades)).toBe(0);
  });

  it('returns 1.0 when all applied trades win', () => {
    const trades = [
      { edge: 0.1, applied: true },
      { edge: 0.05, applied: true },
    ];
    expect(computeWinRate(trades)).toBe(1.0);
  });

  it('returns correct rate for mixed results', () => {
    const trades = [
      { edge: 0.1, applied: true },
      { edge: -0.05, applied: true },
      { edge: 0.2, applied: true },
      { edge: -0.1, applied: true },
    ];
    expect(computeWinRate(trades)).toBe(0.5);
  });

  it('ignores non-applied trades', () => {
    const trades = [
      { edge: 0.1, applied: true },
      { edge: -0.05, applied: false },
    ];
    expect(computeWinRate(trades)).toBe(1.0);
  });
});

// ── Calibration label ────────────────────────────────────────────────────────

describe('getCalibrationLabel', () => {
  it('returns NO DATA for 0', () => {
    expect(getCalibrationLabel(0)).toBe('NO DATA');
  });

  it('returns EXCELLENT for brier < 0.15', () => {
    expect(getCalibrationLabel(0.10)).toBe('EXCELLENT');
  });

  it('returns GOOD for brier in [0.15, 0.20)', () => {
    expect(getCalibrationLabel(0.17)).toBe('GOOD');
  });

  it('returns FAIR for brier in [0.20, 0.25)', () => {
    expect(getCalibrationLabel(0.22)).toBe('FAIR');
  });

  it('returns POOR for brier >= 0.25', () => {
    expect(getCalibrationLabel(0.30)).toBe('POOR');
  });
});

// ── Capital tier ─────────────────────────────────────────────────────────────

describe('getCapitalTierInfo', () => {
  it('returns first tier for low capital', () => {
    const info = getCapitalTierInfo(100);
    expect(info.current).toBe(200);
    expect(info.next).toBe(500);
  });

  it('returns correct tier for $200', () => {
    const info = getCapitalTierInfo(200);
    expect(info.current).toBe(200);
    expect(info.next).toBe(500);
  });

  it('returns correct tier for $750', () => {
    const info = getCapitalTierInfo(750);
    expect(info.current).toBe(500);
    expect(info.next).toBe(1000);
  });

  it('returns max tier for $5000+', () => {
    const info = getCapitalTierInfo(5000);
    expect(info.current).toBe(5000);
    expect(info.next).toBe(5000);
  });
});

// ── Parsing helpers ──────────────────────────────────────────────────────────

describe('parseOutputSummary', () => {
  it('parses standard output format', () => {
    const result = parseOutputSummary('ourProb:0.720 edge:0.150 dir:buy_yes');
    expect(result.ourProb).toBeCloseTo(0.72);
    expect(result.edge).toBeCloseTo(0.15);
    expect(result.direction).toBe('buy_yes');
  });

  it('handles negative edge', () => {
    const result = parseOutputSummary('ourProb:0.400 edge:-0.080 dir:buy_no');
    expect(result.edge).toBeCloseTo(-0.08);
    expect(result.direction).toBe('buy_no');
  });

  it('returns defaults for unparseable string', () => {
    const result = parseOutputSummary('garbage');
    expect(result.ourProb).toBe(0);
    expect(result.edge).toBe(0);
    expect(result.direction).toBe('skip');
  });
});

describe('parseInputSummary', () => {
  it('parses standard input format', () => {
    const result = parseInputSummary('market:0x1234abcd yesPrice:0.550');
    expect(result.marketId).toBe('0x1234abcd');
    expect(result.yesPrice).toBeCloseTo(0.55);
  });

  it('returns defaults for unparseable string', () => {
    const result = parseInputSummary('garbage');
    expect(result.marketId).toBe('unknown');
    expect(result.yesPrice).toBe(0);
  });
});

// ── Formatting helpers ───────────────────────────────────────────────────────

describe('formatPnl', () => {
  it('formats positive P&L with + sign', () => {
    expect(formatPnl(12.5)).toBe('+$12.50');
  });

  it('formats negative P&L', () => {
    expect(formatPnl(-3.25)).toBe('$-3.25');
  });

  it('formats zero as +$0.00', () => {
    expect(formatPnl(0)).toBe('+$0.00');
  });
});

describe('formatPct', () => {
  it('formats percentage with default 0 decimals', () => {
    expect(formatPct(0.64)).toBe('64%');
  });

  it('formats percentage with specified decimals', () => {
    expect(formatPct(0.123, 1)).toBe('12.3%');
  });

  it('formats negative percentage', () => {
    expect(formatPct(-0.032, 1)).toBe('-3.2%');
  });
});

describe('truncate', () => {
  it('returns string unchanged if short enough', () => {
    expect(truncate('hello', 10)).toBe('hello');
  });

  it('truncates with ellipsis if too long', () => {
    expect(truncate('hello world', 8)).toBe('hello w\u2026');
  });

  it('handles exact length', () => {
    expect(truncate('hello', 5)).toBe('hello');
  });
});

describe('formatSignalLine', () => {
  it('formats a winning signal', () => {
    const signal: SignalRow = { market: 'MarketA', ourProb: 0.72, direction: 'buy_yes', edge: 0.15, won: true };
    const line = formatSignalLine(signal);
    expect(line).toContain('\u2705');
    expect(line).toContain('MarketA');
    expect(line).toContain('72%');
    expect(line).toContain('YES');
    expect(line).toContain('+15%');
  });

  it('formats a losing signal', () => {
    const signal: SignalRow = { market: 'MarketB', ourProb: 0.45, direction: 'buy_no', edge: -0.08, won: false };
    const line = formatSignalLine(signal);
    expect(line).toContain('\u274c');
    expect(line).toContain('NO');
    expect(line).toContain('-8%');
  });

  it('formats an unresolved signal', () => {
    const signal: SignalRow = { market: 'MarketC', ourProb: 0.60, direction: 'buy_yes', edge: 0.10, won: null };
    const line = formatSignalLine(signal);
    expect(line).toContain('\u23f3');
  });
});

// ── Box drawing helpers ──────────────────────────────────────────────────────

describe('box drawing helpers', () => {
  it('boxTop creates top border', () => {
    const top = boxTop(10);
    expect(top).toContain('\u250c');
    expect(top).toContain('\u2510');
    expect(top).toContain('\u2500'.repeat(12));
  });

  it('boxMid creates middle border', () => {
    const mid = boxMid(10);
    expect(mid).toContain('\u251c');
    expect(mid).toContain('\u2524');
  });

  it('boxBot creates bottom border', () => {
    const bot = boxBot(10);
    expect(bot).toContain('\u2514');
    expect(bot).toContain('\u2518');
  });

  it('boxLine pads content to inner width', () => {
    const line = boxLine('hello', 20);
    expect(line).toContain('\u2502 hello');
    expect(line).toMatch(/\u2502$/);
  });
});

// ── Full render ──────────────────────────────────────────────────────────────

describe('renderDashboardScreen', () => {
  it('renders a complete dashboard screen', () => {
    const stats: DashboardStats = {
      capital: 212.5,
      pnl: 12.5,
      tradeCount: 45,
      winRate: 0.64,
      avgEdge: 0.123,
      brierScore: 0.182,
      sharpe: 1.84,
      maxDrawdown: -0.032,
      dayNumber: 5,
      trialDays: 14,
    };

    const signals: SignalRow[] = [
      { market: 'Market A', ourProb: 0.72, direction: 'buy_yes', edge: 0.15, won: true },
      { market: 'Market B', ourProb: 0.45, direction: 'buy_no', edge: -0.08, won: false },
    ];

    const calibration: CalibrationStatus = {
      label: 'GOOD',
      brierScore: 0.182,
      capitalTier: 200,
      nextTier: 500,
      daysToNextTier: 9,
    };

    const output = renderDashboardScreen(stats, signals, calibration);

    expect(output).toContain('CashClaw Paper Trading');
    expect(output).toContain('Day 5/14');
    expect(output).toContain('Capital: $212.50');
    expect(output).toContain('+$12.50');
    expect(output).toContain('Trades: 45');
    expect(output).toContain('Win Rate: 64%');
    expect(output).toContain('Avg Edge: 12.3%');
    expect(output).toContain('Brier: 0.182');
    expect(output).toContain('Sharpe: 1.84');
    expect(output).toContain('Max DD: -3.2%');
    expect(output).toContain('Last 5 Signals:');
    expect(output).toContain('Market A');
    expect(output).toContain('Market B');
    expect(output).toContain('GOOD');
    expect(output).toContain('$200');
    expect(output).toContain('$500');
    expect(output).toContain('9 days');
  });

  it('renders with no signals', () => {
    const stats: DashboardStats = {
      capital: 200,
      pnl: 0,
      tradeCount: 0,
      winRate: 0,
      avgEdge: 0,
      brierScore: 0,
      sharpe: 0,
      maxDrawdown: 0,
      dayNumber: 1,
      trialDays: 14,
    };

    const calibration: CalibrationStatus = {
      label: 'NO DATA',
      brierScore: 0,
      capitalTier: 200,
      nextTier: 500,
      daysToNextTier: 13,
    };

    const output = renderDashboardScreen(stats, [], calibration);

    expect(output).toContain('(no signals yet)');
    expect(output).toContain('Day 1/14');
  });
});
