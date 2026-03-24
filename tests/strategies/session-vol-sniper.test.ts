import { describe, it, expect, vi } from 'vitest';
import {
  detectSession,
  calcRealizedVol,
  detectVolSpike,
  detectMomentum,
  filterTicksByWindow,
  createSessionVolSniperTick,
  type SessionVolSniperDeps,
} from '../../src/strategies/polymarket/session-vol-sniper.js';
import type { RawOrderBook } from '../../src/polymarket/clob-client.js';

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeBook(bids: [string, string][], asks: [string, string][]): RawOrderBook {
  return {
    market: 'test-market',
    asset_id: 'test-token',
    bids: bids.map(([price, size]) => ({ price, size })),
    asks: asks.map(([price, size]) => ({ price, size })),
    hash: 'abc',
  };
}

function makeTicks(prices: number[], baseTime = Date.now(), intervalMs = 30_000) {
  return prices.map((price, i) => ({ price, timestamp: baseTime + i * intervalMs }));
}

// ── detectSession tests ─────────────────────────────────────────────────────

describe('detectSession', () => {
  it('detects London open (08:00-09:00 UTC)', () => {
    const date = new Date('2026-03-24T08:30:00Z');
    expect(detectSession(date)).toBe('london-open');
  });

  it('detects US market open (13:30-14:30 UTC)', () => {
    const date = new Date('2026-03-24T14:00:00Z');
    expect(detectSession(date)).toBe('us-open');
  });

  it('detects Asia open (00:00-02:00 UTC)', () => {
    const date = new Date('2026-03-24T01:00:00Z');
    expect(detectSession(date)).toBe('asia-open');
  });

  it('returns off-session outside all windows', () => {
    const date = new Date('2026-03-24T10:00:00Z');
    expect(detectSession(date)).toBe('off-session');
  });

  it('detects resolution window when near market end', () => {
    const endDate = '2026-03-24T15:00:00Z';
    const now = new Date('2026-03-24T14:35:00Z'); // 25 min before end
    expect(detectSession(now, endDate, 30)).toBe('resolution-window');
  });

  it('resolution window takes priority over session window', () => {
    const endDate = '2026-03-24T08:45:00Z';
    const now = new Date('2026-03-24T08:30:00Z'); // During London open but near market end
    expect(detectSession(now, endDate, 30)).toBe('resolution-window');
  });

  it('does not trigger resolution window when far from end', () => {
    const endDate = '2026-12-31T00:00:00Z';
    const now = new Date('2026-03-24T08:30:00Z');
    expect(detectSession(now, endDate, 30)).toBe('london-open');
  });
});

// ── calcRealizedVol tests ───────────────────────────────────────────────────

describe('calcRealizedVol', () => {
  it('returns 0 for < 2 ticks', () => {
    expect(calcRealizedVol([])).toBe(0);
    expect(calcRealizedVol([{ price: 0.5, timestamp: 0 }])).toBe(0);
  });

  it('returns 0 for constant prices', () => {
    const ticks = makeTicks([0.5, 0.5, 0.5, 0.5]);
    expect(calcRealizedVol(ticks)).toBe(0);
  });

  it('returns positive for varying prices', () => {
    const ticks = makeTicks([0.50, 0.52, 0.48, 0.51]);
    expect(calcRealizedVol(ticks)).toBeGreaterThan(0);
  });

  it('higher volatility gives higher value', () => {
    const lowVol = makeTicks([0.50, 0.51, 0.50, 0.51]);
    const highVol = makeTicks([0.50, 0.60, 0.40, 0.55]);
    expect(calcRealizedVol(highVol)).toBeGreaterThan(calcRealizedVol(lowVol));
  });
});

// ── detectVolSpike tests ────────────────────────────────────────────────────

describe('detectVolSpike', () => {
  it('returns false when baseline is 0', () => {
    expect(detectVolSpike(0.05, 0, 2.0)).toBe(false);
  });

  it('returns false when vol5m below threshold', () => {
    expect(detectVolSpike(0.03, 0.02, 2.0)).toBe(false); // 0.03 < 0.02*2
  });

  it('returns true when vol5m above threshold', () => {
    expect(detectVolSpike(0.05, 0.02, 2.0)).toBe(true); // 0.05 > 0.02*2
  });
});

// ── detectMomentum tests ────────────────────────────────────────────────────

describe('detectMomentum', () => {
  it('returns flat for < 2 ticks', () => {
    expect(detectMomentum([])).toBe('flat');
    expect(detectMomentum([{ price: 0.5, timestamp: 0 }])).toBe('flat');
  });

  it('returns up when price increased', () => {
    const ticks = makeTicks([0.50, 0.52, 0.54]);
    expect(detectMomentum(ticks)).toBe('up');
  });

  it('returns down when price decreased', () => {
    const ticks = makeTicks([0.50, 0.48, 0.46]);
    expect(detectMomentum(ticks)).toBe('down');
  });

  it('returns flat for tiny changes', () => {
    const ticks = makeTicks([0.5000, 0.5005]);
    expect(detectMomentum(ticks)).toBe('flat');
  });
});

// ── filterTicksByWindow tests ───────────────────────────────────────────────

describe('filterTicksByWindow', () => {
  it('returns empty for empty input', () => {
    expect(filterTicksByWindow([], 60_000, Date.now())).toEqual([]);
  });

  it('filters out old ticks', () => {
    const now = 100_000;
    const ticks = [
      { price: 0.50, timestamp: 10_000 },   // too old
      { price: 0.51, timestamp: 50_000 },    // within window
      { price: 0.52, timestamp: 90_000 },    // within window
    ];
    const result = filterTicksByWindow(ticks, 60_000, now);
    expect(result).toHaveLength(2);
    expect(result[0].timestamp).toBe(50_000);
  });
});

// ── Tick factory tests ──────────────────────────────────────────────────────

function makeDeps(overrides: Partial<SessionVolSniperDeps> = {}): SessionVolSniperDeps {
  return {
    clob: {
      getOrderBook: vi.fn().mockResolvedValue(
        makeBook(
          [['0.48', '100'], ['0.47', '80']],
          [['0.52', '100'], ['0.53', '80']],
        ),
      ),
    } as any,
    orderManager: {
      placeOrder: vi.fn().mockResolvedValue({ id: 'order-1' }),
    } as any,
    eventBus: { emit: vi.fn() } as any,
    gamma: {
      getTrending: vi.fn().mockResolvedValue([
        {
          id: 'm1', question: 'Test?', slug: 'test', conditionId: 'cond-1',
          yesTokenId: 'yes-1', noTokenId: 'no-1', yesPrice: 0.50, noPrice: 0.50,
          volume: 1000, volume24h: 500, liquidity: 5000, endDate: '2026-12-31',
          active: true, closed: false, resolved: false, outcome: null,
        },
      ]),
    } as any,
    // Default clock: during London open
    clock: () => new Date('2026-03-24T08:30:00Z'),
    ...overrides,
  };
}

describe('createSessionVolSniperTick', () => {
  it('returns a function', () => {
    const tick = createSessionVolSniperTick(makeDeps());
    expect(typeof tick).toBe('function');
  });

  it('does not place orders on first tick (insufficient history)', async () => {
    const deps = makeDeps();
    const tick = createSessionVolSniperTick(deps);
    await tick();
    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
  });

  it('does not throw on gamma API error', async () => {
    const deps = makeDeps({
      gamma: { getTrending: vi.fn().mockRejectedValue(new Error('API error')) } as any,
    });
    const tick = createSessionVolSniperTick(deps);
    await expect(tick()).resolves.toBeUndefined();
  });

  it('does not throw on clob API error', async () => {
    const deps = makeDeps({
      clob: { getOrderBook: vi.fn().mockRejectedValue(new Error('timeout')) } as any,
    });
    const tick = createSessionVolSniperTick(deps);
    await expect(tick()).resolves.toBeUndefined();
  });

  it('skips entries during off-session', async () => {
    const deps = makeDeps({
      clock: () => new Date('2026-03-24T10:00:00Z'), // off-session
    });
    const tick = createSessionVolSniperTick(deps);
    for (let i = 0; i < 30; i++) await tick();
    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
  });

  it('skips closed/resolved markets', async () => {
    const deps = makeDeps({
      gamma: {
        getTrending: vi.fn().mockResolvedValue([{
          id: 'm1', conditionId: 'cond-1', yesTokenId: 'yes-1', noTokenId: 'no-1',
          closed: true, resolved: false, active: true,
        }]),
      } as any,
    });
    const tick = createSessionVolSniperTick(deps);
    await tick();
    expect(deps.clob.getOrderBook).not.toHaveBeenCalled();
  });

  it('enters mean-reversion trade on vol spike during active session', async () => {
    vi.useFakeTimers();
    // Start at London open
    vi.setSystemTime(new Date('2026-03-24T08:00:00Z'));

    // Stable books with tiny variation
    const stableBooks = [
      makeBook([['0.49', '100']], [['0.51', '100']]),   // mid 0.50
      makeBook([['0.491', '100']], [['0.511', '100']]), // mid 0.501
      makeBook([['0.489', '100']], [['0.509', '100']]), // mid 0.499
      makeBook([['0.490', '100']], [['0.510', '100']]), // mid 0.50
    ];
    // Spike: big upward moves
    const spikeBooks = [
      makeBook([['0.55', '100']], [['0.57', '100']]), // mid 0.56
      makeBook([['0.59', '100']], [['0.61', '100']]), // mid 0.60
      makeBook([['0.63', '100']], [['0.65', '100']]), // mid 0.64
      makeBook([['0.66', '100']], [['0.68', '100']]), // mid 0.67
      makeBook([['0.69', '100']], [['0.71', '100']]), // mid 0.70
    ];

    let callCount = 0;
    const clob = {
      getOrderBook: vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount <= 20) {
          return Promise.resolve(stableBooks[callCount % stableBooks.length]);
        }
        const idx = Math.min(callCount - 21, spikeBooks.length - 1);
        return Promise.resolve(spikeBooks[idx]);
      }),
    };

    const deps = makeDeps({
      clob: clob as any,
      clock: () => new Date('2026-03-24T08:30:00Z'), // London open
      config: {
        minShortTicks: 3,
        minBaselineTicks: 10,
        spikeMultiplier: 1.5,
        shortWindowMs: 5 * 60_000,     // 5 min short window
        baselineWindowMs: 60 * 60_000, // 1 hour baseline
      },
    });
    const tick = createSessionVolSniperTick(deps);

    // Build baseline: 20 ticks spaced 2 min apart (40 min of baseline data)
    for (let i = 0; i < 20; i++) {
      await tick();
      vi.advanceTimersByTime(2 * 60_000); // 2 minutes between ticks
    }

    // Vol spike: 5 ticks spaced 30s apart (within 5-min short window)
    for (let i = 0; i < 5; i++) {
      await tick();
      vi.advanceTimersByTime(30_000); // 30 seconds between spike ticks
    }

    expect(deps.orderManager.placeOrder).toHaveBeenCalled();
    vi.useRealTimers();
  });
});
