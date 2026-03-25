import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  detectSpike,
  calcReversion,
  shouldFade,
  createNewsCatalystFadeTick,
  type PriceSnapshot,
  type SpikeEvent,
  type NewsCatalystFadeConfig,
  type NewsCatalystFadeDeps,
  DEFAULT_CONFIG,
} from '../../src/strategies/polymarket/news-catalyst-fade.js';
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

function makeSnapshots(prices: number[], startTs = 1000, interval = 1000, volume = 10000): PriceSnapshot[] {
  return prices.map((price, i) => ({ price, timestamp: startTs + i * interval, volume }));
}

function makeSpike(overrides?: Partial<SpikeEvent>): SpikeEvent {
  return {
    preSpike: 0.50,
    peak: 0.60,
    direction: 'up',
    detectedAt: 10000,
    ...overrides,
  };
}

function makeEvent(markets: Array<{
  id?: string;
  conditionId?: string;
  yesTokenId: string;
  noTokenId?: string;
  closed?: boolean;
  resolved?: boolean;
  active?: boolean;
}>) {
  return {
    id: 'evt-1',
    title: 'Test Event',
    slug: 'test-event',
    description: 'Test',
    markets: markets.map((m, i) => ({
      id: m.id ?? `mkt-${i}`,
      question: `Market?`,
      slug: `market-${i}`,
      conditionId: m.conditionId ?? `cond-${i}`,
      yesTokenId: m.yesTokenId,
      noTokenId: m.noTokenId ?? `no-${m.yesTokenId}`,
      yesPrice: 0.50,
      noPrice: 0.50,
      volume: 50000,
      volume24h: 20000,
      liquidity: 5000,
      endDate: '2026-12-31',
      active: m.active ?? true,
      closed: m.closed ?? false,
      resolved: m.resolved ?? false,
      outcome: null,
    })),
  };
}

function makeDeps(overrides?: Partial<NewsCatalystFadeDeps>): NewsCatalystFadeDeps {
  return {
    clob: { getOrderBook: vi.fn() } as any,
    orderManager: { placeOrder: vi.fn().mockResolvedValue({ id: 'ord-1' }) } as any,
    eventBus: { emit: vi.fn() } as any,
    gamma: { getEvents: vi.fn().mockResolvedValue([]) } as any,
    ...overrides,
  };
}

/** Build a book with a specific mid price and volume */
function bookAtMid(mid: number, volume = 10000): RawOrderBook {
  const half = volume / 2;
  return makeBook(
    [[String(mid - 0.01), String(half)]],
    [[String(mid + 0.01), String(half)]],
  );
}

// ── detectSpike ─────────────────────────────────────────────────────────────

describe('detectSpike', () => {
  it('returns null for fewer than 2 snapshots', () => {
    expect(detectSpike([], 0.08, 60000)).toBeNull();
    expect(detectSpike([{ price: 0.5, timestamp: 1000, volume: 100 }], 0.08, 60000)).toBeNull();
  });

  it('returns null when price change is below threshold', () => {
    const snaps = makeSnapshots([0.50, 0.52], 1000, 1000);
    expect(detectSpike(snaps, 0.08, 60000)).toBeNull();
  });

  it('detects an upward spike', () => {
    const snaps = makeSnapshots([0.50, 0.55, 0.60], 1000, 1000);
    const spike = detectSpike(snaps, 0.08, 60000);
    expect(spike).not.toBeNull();
    expect(spike!.direction).toBe('up');
    expect(spike!.preSpike).toBe(0.50);
    expect(spike!.peak).toBe(0.60);
  });

  it('detects a downward spike', () => {
    const snaps = makeSnapshots([0.60, 0.55, 0.50], 1000, 1000);
    const spike = detectSpike(snaps, 0.08, 60000);
    expect(spike).not.toBeNull();
    expect(spike!.direction).toBe('down');
    expect(spike!.preSpike).toBe(0.60);
    expect(spike!.peak).toBe(0.50);
  });

  it('ignores snapshots outside the window', () => {
    // First snapshot is outside window, second and third are inside
    const snaps: PriceSnapshot[] = [
      { price: 0.30, timestamp: 1000, volume: 100 },
      { price: 0.50, timestamp: 50000, volume: 100 },
      { price: 0.52, timestamp: 51000, volume: 100 },
    ];
    // window = 5000ms, so only ts >= 46000 count. Earliest in window = 0.50, change = 0.02 < 0.08
    expect(detectSpike(snaps, 0.08, 5000)).toBeNull();
  });

  it('finds peak within window for up spike', () => {
    const snaps = makeSnapshots([0.50, 0.65, 0.60], 1000, 1000);
    const spike = detectSpike(snaps, 0.08, 60000);
    expect(spike!.peak).toBe(0.65);
  });

  it('finds trough within window for down spike', () => {
    const snaps = makeSnapshots([0.60, 0.45, 0.50], 1000, 1000);
    const spike = detectSpike(snaps, 0.08, 60000);
    expect(spike!.peak).toBe(0.45);
  });

  it('returns null when earliest equals current (single point in window)', () => {
    const snaps: PriceSnapshot[] = [
      { price: 0.30, timestamp: 1000, volume: 100 },
      { price: 0.50, timestamp: 100000, volume: 100 },
    ];
    // window = 1ms, only the last snapshot is in range
    expect(detectSpike(snaps, 0.01, 1)).toBeNull();
  });
});

// ── calcReversion ───────────────────────────────────────────────────────────

describe('calcReversion', () => {
  it('returns 0 when spike magnitude is 0', () => {
    const spike = makeSpike({ preSpike: 0.50, peak: 0.50 });
    expect(calcReversion(spike, 0.50)).toBe(0);
  });

  it('returns 0 when no reversion (price still at peak) for up spike', () => {
    const spike = makeSpike({ preSpike: 0.50, peak: 0.60 });
    expect(calcReversion(spike, 0.60)).toBe(0);
  });

  it('returns 1 when fully reverted for up spike', () => {
    const spike = makeSpike({ preSpike: 0.50, peak: 0.60 });
    expect(calcReversion(spike, 0.50)).toBe(1);
  });

  it('returns correct fraction for partial reversion (up spike)', () => {
    const spike = makeSpike({ preSpike: 0.50, peak: 0.60 });
    // price at 0.55 → reverted 50%
    expect(calcReversion(spike, 0.55)).toBeCloseTo(0.5);
  });

  it('returns correct fraction for partial reversion (down spike)', () => {
    const spike = makeSpike({ preSpike: 0.60, peak: 0.50, direction: 'down' });
    // price at 0.55 → reverted 50%
    expect(calcReversion(spike, 0.55)).toBeCloseTo(0.5);
  });

  it('clamps to 0 when price goes further from preSpike', () => {
    const spike = makeSpike({ preSpike: 0.50, peak: 0.60 });
    // price at 0.65 → even further up
    expect(calcReversion(spike, 0.65)).toBe(0);
  });

  it('clamps to 1 when price overshoots past preSpike', () => {
    const spike = makeSpike({ preSpike: 0.50, peak: 0.60 });
    expect(calcReversion(spike, 0.40)).toBe(1);
  });
});

// ── shouldFade ──────────────────────────────────────────────────────────────

describe('shouldFade', () => {
  const spike = makeSpike({ preSpike: 0.50, peak: 0.60, detectedAt: 10000 });

  it('returns false if spike has expired', () => {
    // now = 400000, fadeWindow = 300000 → expired
    expect(shouldFade(spike, 0.55, 400000, 0.20, 0.70, 300000)).toBe(false);
  });

  it('returns false if reversion is below minimum', () => {
    // price at 0.59 → reversion = 0.1 < 0.20
    expect(shouldFade(spike, 0.59, 11000, 0.20, 0.70, 300000)).toBe(false);
  });

  it('returns false if reversion exceeds max (anti-chase)', () => {
    // price at 0.52 → reversion = 0.8 > 0.70
    expect(shouldFade(spike, 0.52, 11000, 0.20, 0.70, 300000)).toBe(false);
  });

  it('returns true when reversion is in the sweet spot', () => {
    // price at 0.55 → reversion = 0.50, between 0.20 and 0.70
    expect(shouldFade(spike, 0.55, 11000, 0.20, 0.70, 300000)).toBe(true);
  });

  it('returns true at exact lower boundary', () => {
    // reversion = 0.20 exactly
    const price = 0.60 - 0.20 * 0.10; // 0.58
    expect(shouldFade(spike, price, 11000, 0.20, 0.70, 300000)).toBe(true);
  });

  it('returns false at exact upper boundary (anti-chase)', () => {
    // reversion > 0.70 — at boundary calcReversion may round
    const price = 0.60 - 0.71 * 0.10; // 0.529
    expect(shouldFade(spike, price, 11000, 0.20, 0.70, 300000)).toBe(false);
  });
});

// ── createNewsCatalystFadeTick integration ──────────────────────────────────

describe('createNewsCatalystFadeTick', () => {
  let deps: NewsCatalystFadeDeps;
  let tick: () => Promise<void>;

  const fastConfig: Partial<NewsCatalystFadeConfig> = {
    spikeThreshold: 0.08,
    spikeWindowMs: 60_000,
    reversionPct: 0.20,
    maxReversionPct: 0.70,
    fadeWindowMs: 300_000,
    minVolume: 100,
    takeProfitPct: 0.035,
    stopLossPct: 0.025,
    maxHoldMs: 20 * 60_000,
    maxPositions: 3,
    cooldownMs: 180_000,
    positionSize: '12',
    maxSnapshots: 200,
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(10000);
    deps = makeDeps({ config: fastConfig });
    tick = createNewsCatalystFadeTick(deps);
  });

  it('does nothing when gamma returns no events', async () => {
    (deps.gamma.getEvents as any).mockResolvedValue([]);
    await tick();
    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
  });

  it('skips closed markets', async () => {
    (deps.gamma.getEvents as any).mockResolvedValue([
      makeEvent([{ yesTokenId: 'yes-1', closed: true }]),
    ]);
    await tick();
    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
  });

  it('skips resolved markets', async () => {
    (deps.gamma.getEvents as any).mockResolvedValue([
      makeEvent([{ yesTokenId: 'yes-1', resolved: true }]),
    ]);
    await tick();
    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
  });

  it('skips inactive markets', async () => {
    (deps.gamma.getEvents as any).mockResolvedValue([
      makeEvent([{ yesTokenId: 'yes-1', active: false }]),
    ]);
    await tick();
    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
  });

  it('needs at least 3 snapshots before entry (spike detection)', async () => {
    const event = makeEvent([{ yesTokenId: 'yes-1' }]);
    (deps.gamma.getEvents as any).mockResolvedValue([event]);
    (deps.clob.getOrderBook as any).mockResolvedValue(bookAtMid(0.50, 10000));

    // First two ticks build snapshots but not enough
    await tick();
    vi.setSystemTime(11000);
    await tick();
    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
  });

  it('detects spike and enters fade position on up spike', async () => {
    const event = makeEvent([{ yesTokenId: 'yes-1', noTokenId: 'no-1' }]);
    (deps.gamma.getEvents as any).mockResolvedValue([event]);

    // Build up snapshots showing a spike up then partial reversion
    // Tick 1: price = 0.50
    (deps.clob.getOrderBook as any).mockResolvedValue(bookAtMid(0.50, 10000));
    vi.setSystemTime(10000);
    await tick();

    // Tick 2: price = 0.55
    (deps.clob.getOrderBook as any).mockResolvedValue(bookAtMid(0.55, 10000));
    vi.setSystemTime(11000);
    await tick();

    // Tick 3: price = 0.60 → spike detected (change = 0.10 > 0.08)
    (deps.clob.getOrderBook as any).mockResolvedValue(bookAtMid(0.60, 10000));
    vi.setSystemTime(12000);
    await tick();

    // Tick 4: price = 0.55 → reversion = 0.5 (in range 0.20-0.70)
    // Up spike → buy NO token
    (deps.clob.getOrderBook as any).mockResolvedValue(bookAtMid(0.55, 10000));
    vi.setSystemTime(13000);
    await tick();

    expect(deps.orderManager.placeOrder).toHaveBeenCalled();
    const call = (deps.orderManager.placeOrder as any).mock.calls.find(
      (c: any[]) => c[0].tokenId === 'no-1',
    );
    expect(call).toBeTruthy();
    expect(call[0].side).toBe('buy');
  });

  it('enters YES position on down spike', async () => {
    const event = makeEvent([{ yesTokenId: 'yes-1', noTokenId: 'no-1' }]);
    (deps.gamma.getEvents as any).mockResolvedValue([event]);

    // Tick 1: price = 0.60
    (deps.clob.getOrderBook as any).mockResolvedValue(bookAtMid(0.60, 10000));
    vi.setSystemTime(10000);
    await tick();

    // Tick 2: price = 0.55
    (deps.clob.getOrderBook as any).mockResolvedValue(bookAtMid(0.55, 10000));
    vi.setSystemTime(11000);
    await tick();

    // Tick 3: price = 0.50 → spike down (0.10 > 0.08)
    (deps.clob.getOrderBook as any).mockResolvedValue(bookAtMid(0.50, 10000));
    vi.setSystemTime(12000);
    await tick();

    // Tick 4: price = 0.55 → reversion = 0.5
    // Down spike → buy YES
    (deps.clob.getOrderBook as any).mockResolvedValue(bookAtMid(0.55, 10000));
    vi.setSystemTime(13000);
    await tick();

    expect(deps.orderManager.placeOrder).toHaveBeenCalled();
    const call = (deps.orderManager.placeOrder as any).mock.calls.find(
      (c: any[]) => c[0].tokenId === 'yes-1',
    );
    expect(call).toBeTruthy();
    expect(call[0].side).toBe('buy');
  });

  it('anti-chase: does not enter when reversion exceeds max', async () => {
    const event = makeEvent([{ yesTokenId: 'yes-1' }]);
    (deps.gamma.getEvents as any).mockResolvedValue([event]);

    // Build spike up
    (deps.clob.getOrderBook as any).mockResolvedValue(bookAtMid(0.50, 10000));
    vi.setSystemTime(10000);
    await tick();
    (deps.clob.getOrderBook as any).mockResolvedValue(bookAtMid(0.55, 10000));
    vi.setSystemTime(11000);
    await tick();
    (deps.clob.getOrderBook as any).mockResolvedValue(bookAtMid(0.60, 10000));
    vi.setSystemTime(12000);
    await tick();

    // Price already reverted 80% → beyond maxReversionPct of 0.70
    (deps.clob.getOrderBook as any).mockResolvedValue(bookAtMid(0.52, 10000));
    vi.setSystemTime(13000);
    await tick();

    // Should not have placed an entry order
    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
  });

  it('skips markets with volume below minVolume', async () => {
    const event = makeEvent([{ yesTokenId: 'yes-1' }]);
    (deps.gamma.getEvents as any).mockResolvedValue([event]);

    // Volume = 50, minVolume = 100
    (deps.clob.getOrderBook as any).mockResolvedValue(bookAtMid(0.50, 50));
    vi.setSystemTime(10000);
    await tick();
    (deps.clob.getOrderBook as any).mockResolvedValue(bookAtMid(0.60, 50));
    vi.setSystemTime(11000);
    await tick();
    (deps.clob.getOrderBook as any).mockResolvedValue(bookAtMid(0.60, 50));
    vi.setSystemTime(12000);
    await tick();

    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
  });

  it('enforces maxPositions limit', async () => {
    deps = makeDeps({ config: { ...fastConfig, maxPositions: 1 } });
    tick = createNewsCatalystFadeTick(deps);

    const event = makeEvent([
      { yesTokenId: 'yes-1', noTokenId: 'no-1' },
      { yesTokenId: 'yes-2', noTokenId: 'no-2' },
    ]);
    (deps.gamma.getEvents as any).mockResolvedValue([event]);

    // Build spikes on both markets
    (deps.clob.getOrderBook as any).mockResolvedValue(bookAtMid(0.50, 10000));
    vi.setSystemTime(10000);
    await tick();
    (deps.clob.getOrderBook as any).mockResolvedValue(bookAtMid(0.55, 10000));
    vi.setSystemTime(11000);
    await tick();
    (deps.clob.getOrderBook as any).mockResolvedValue(bookAtMid(0.60, 10000));
    vi.setSystemTime(12000);
    await tick();
    (deps.clob.getOrderBook as any).mockResolvedValue(bookAtMid(0.55, 10000));
    vi.setSystemTime(13000);
    await tick();

    // Only 1 entry order (maxPositions=1), plus exit checks may call getOrderBook
    const entryCalls = (deps.orderManager.placeOrder as any).mock.calls.filter(
      (c: any[]) => c[0].side === 'buy',
    );
    expect(entryCalls.length).toBe(1);
  });

  describe('exits', () => {
    async function setupPosition(): Promise<void> {
      const event = makeEvent([{ yesTokenId: 'yes-1', noTokenId: 'no-1' }]);
      (deps.gamma.getEvents as any).mockResolvedValue([event]);

      // Build a down spike so we buy YES at ~0.55
      (deps.clob.getOrderBook as any).mockResolvedValue(bookAtMid(0.60, 10000));
      vi.setSystemTime(10000);
      await tick();
      (deps.clob.getOrderBook as any).mockResolvedValue(bookAtMid(0.55, 10000));
      vi.setSystemTime(11000);
      await tick();
      (deps.clob.getOrderBook as any).mockResolvedValue(bookAtMid(0.50, 10000));
      vi.setSystemTime(12000);
      await tick();
      // Reversion for entry
      (deps.clob.getOrderBook as any).mockResolvedValue(bookAtMid(0.55, 10000));
      vi.setSystemTime(13000);
      await tick();

      // Verify entry happened
      expect(deps.orderManager.placeOrder).toHaveBeenCalled();
      (deps.orderManager.placeOrder as any).mockClear();
    }

    it('take-profit: exits when pnl >= takeProfitPct', async () => {
      await setupPosition();

      // Price moves in our favor (we bought YES, price goes up)
      // Entry was ~0.56 (ask), TP at 3.5% → ~0.58
      (deps.clob.getOrderBook as any).mockResolvedValue(bookAtMid(0.62, 10000));
      (deps.gamma.getEvents as any).mockResolvedValue([]);
      vi.setSystemTime(14000);
      await tick();

      expect(deps.orderManager.placeOrder).toHaveBeenCalled();
      expect(deps.eventBus.emit).toHaveBeenCalledWith(
        'trade.executed',
        expect.objectContaining({
          trade: expect.objectContaining({ side: 'sell' }),
        }),
      );
    });

    it('stop-loss: exits when pnl <= -stopLossPct', async () => {
      await setupPosition();

      // Price moves against us (we bought YES, price drops)
      (deps.clob.getOrderBook as any).mockResolvedValue(bookAtMid(0.45, 10000));
      (deps.gamma.getEvents as any).mockResolvedValue([]);
      vi.setSystemTime(14000);
      await tick();

      expect(deps.orderManager.placeOrder).toHaveBeenCalled();
    });

    it('max-hold: exits after maxHoldMs', async () => {
      await setupPosition();

      // Price is neutral but time has passed
      (deps.clob.getOrderBook as any).mockResolvedValue(bookAtMid(0.55, 10000));
      (deps.gamma.getEvents as any).mockResolvedValue([]);
      vi.setSystemTime(13000 + 20 * 60_000 + 1);
      await tick();

      expect(deps.orderManager.placeOrder).toHaveBeenCalled();
    });
  });

  it('cooldown prevents re-entry on same token after exit', async () => {
    const event = makeEvent([{ yesTokenId: 'yes-1', noTokenId: 'no-1' }]);
    (deps.gamma.getEvents as any).mockResolvedValue([event]);

    // Build position via down spike
    (deps.clob.getOrderBook as any).mockResolvedValue(bookAtMid(0.60, 10000));
    vi.setSystemTime(10000);
    await tick();
    (deps.clob.getOrderBook as any).mockResolvedValue(bookAtMid(0.55, 10000));
    vi.setSystemTime(11000);
    await tick();
    (deps.clob.getOrderBook as any).mockResolvedValue(bookAtMid(0.50, 10000));
    vi.setSystemTime(12000);
    await tick();
    (deps.clob.getOrderBook as any).mockResolvedValue(bookAtMid(0.55, 10000));
    vi.setSystemTime(13000);
    await tick();

    // Force exit via max hold
    (deps.clob.getOrderBook as any).mockResolvedValue(bookAtMid(0.55, 10000));
    (deps.gamma.getEvents as any).mockResolvedValue([]);
    vi.setSystemTime(13000 + 20 * 60_000 + 1);
    await tick();
    (deps.orderManager.placeOrder as any).mockClear();

    // Now try to build another spike — should be blocked by cooldown
    (deps.gamma.getEvents as any).mockResolvedValue([event]);
    (deps.clob.getOrderBook as any).mockResolvedValue(bookAtMid(0.60, 10000));
    vi.setSystemTime(13000 + 20 * 60_000 + 2000);
    await tick();
    (deps.clob.getOrderBook as any).mockResolvedValue(bookAtMid(0.50, 10000));
    vi.setSystemTime(13000 + 20 * 60_000 + 3000);
    await tick();
    (deps.clob.getOrderBook as any).mockResolvedValue(bookAtMid(0.50, 10000));
    vi.setSystemTime(13000 + 20 * 60_000 + 4000);
    await tick();
    (deps.clob.getOrderBook as any).mockResolvedValue(bookAtMid(0.55, 10000));
    vi.setSystemTime(13000 + 20 * 60_000 + 5000);
    await tick();

    // No new entry because of cooldown
    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
  });

  it('handles clob.getOrderBook errors gracefully', async () => {
    const event = makeEvent([{ yesTokenId: 'yes-1' }]);
    (deps.gamma.getEvents as any).mockResolvedValue([event]);
    (deps.clob.getOrderBook as any).mockRejectedValue(new Error('network'));

    await expect(tick()).resolves.not.toThrow();
    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
  });

  it('handles gamma.getEvents errors gracefully', async () => {
    (deps.gamma.getEvents as any).mockRejectedValue(new Error('gamma down'));
    await expect(tick()).resolves.not.toThrow();
  });

  it('handles orderManager.placeOrder errors on entry', async () => {
    const event = makeEvent([{ yesTokenId: 'yes-1', noTokenId: 'no-1' }]);
    (deps.gamma.getEvents as any).mockResolvedValue([event]);

    // Build spike
    (deps.clob.getOrderBook as any).mockResolvedValue(bookAtMid(0.50, 10000));
    vi.setSystemTime(10000);
    await tick();
    (deps.clob.getOrderBook as any).mockResolvedValue(bookAtMid(0.55, 10000));
    vi.setSystemTime(11000);
    await tick();
    (deps.clob.getOrderBook as any).mockResolvedValue(bookAtMid(0.60, 10000));
    vi.setSystemTime(12000);
    await tick();

    // Make placeOrder fail
    (deps.orderManager.placeOrder as any).mockRejectedValue(new Error('order fail'));
    (deps.clob.getOrderBook as any).mockResolvedValue(bookAtMid(0.55, 10000));
    vi.setSystemTime(13000);
    await expect(tick()).resolves.not.toThrow();
  });

  it('skips markets where mid is 0 or 1', async () => {
    const event = makeEvent([{ yesTokenId: 'yes-1' }]);
    (deps.gamma.getEvents as any).mockResolvedValue([event]);

    // mid = 0
    (deps.clob.getOrderBook as any).mockResolvedValue(
      makeBook([['0', '100']], [['0', '100']]),
    );
    await tick();
    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
  });

  it('emits trade.executed on entry', async () => {
    const event = makeEvent([{ yesTokenId: 'yes-1', noTokenId: 'no-1' }]);
    (deps.gamma.getEvents as any).mockResolvedValue([event]);

    (deps.clob.getOrderBook as any).mockResolvedValue(bookAtMid(0.60, 10000));
    vi.setSystemTime(10000);
    await tick();
    (deps.clob.getOrderBook as any).mockResolvedValue(bookAtMid(0.55, 10000));
    vi.setSystemTime(11000);
    await tick();
    (deps.clob.getOrderBook as any).mockResolvedValue(bookAtMid(0.50, 10000));
    vi.setSystemTime(12000);
    await tick();
    (deps.clob.getOrderBook as any).mockResolvedValue(bookAtMid(0.55, 10000));
    vi.setSystemTime(13000);
    await tick();

    expect(deps.eventBus.emit).toHaveBeenCalledWith(
      'trade.executed',
      expect.objectContaining({
        trade: expect.objectContaining({
          side: 'buy',
          strategy: 'news-catalyst-fade',
        }),
      }),
    );
  });

  it('uses DEFAULT_CONFIG when no config override provided', () => {
    const d = makeDeps();
    const t = createNewsCatalystFadeTick(d);
    // Shouldn't throw — just verify it creates fine
    expect(typeof t).toBe('function');
  });

  it('does not enter when spike window has expired', async () => {
    const event = makeEvent([{ yesTokenId: 'yes-1', noTokenId: 'no-1' }]);
    (deps.gamma.getEvents as any).mockResolvedValue([event]);

    // Build spike
    (deps.clob.getOrderBook as any).mockResolvedValue(bookAtMid(0.50, 10000));
    vi.setSystemTime(10000);
    await tick();
    (deps.clob.getOrderBook as any).mockResolvedValue(bookAtMid(0.55, 10000));
    vi.setSystemTime(11000);
    await tick();
    (deps.clob.getOrderBook as any).mockResolvedValue(bookAtMid(0.60, 10000));
    vi.setSystemTime(12000);
    await tick();

    // Wait past fadeWindowMs (300_000) before reversion
    (deps.clob.getOrderBook as any).mockResolvedValue(bookAtMid(0.55, 10000));
    vi.setSystemTime(12000 + 300_001);
    await tick();

    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
  });

  it('skips market where yesTokenId is falsy', async () => {
    (deps.gamma.getEvents as any).mockResolvedValue([{
      id: 'evt-1',
      title: 'Test',
      slug: 'test',
      description: 'Test',
      markets: [{
        id: 'mkt-1',
        question: 'Q?',
        slug: 'q',
        conditionId: 'cond-1',
        yesTokenId: '',
        noTokenId: 'no-1',
        active: true,
        closed: false,
        resolved: false,
      }],
    }]);

    await tick();
    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
  });

  it('does not double-enter when position already exists for token', async () => {
    deps = makeDeps({ config: { ...fastConfig, maxPositions: 5 } });
    tick = createNewsCatalystFadeTick(deps);

    const event = makeEvent([{ yesTokenId: 'yes-1', noTokenId: 'no-1' }]);
    (deps.gamma.getEvents as any).mockResolvedValue([event]);

    // Build + enter
    (deps.clob.getOrderBook as any).mockResolvedValue(bookAtMid(0.60, 10000));
    vi.setSystemTime(10000);
    await tick();
    (deps.clob.getOrderBook as any).mockResolvedValue(bookAtMid(0.55, 10000));
    vi.setSystemTime(11000);
    await tick();
    (deps.clob.getOrderBook as any).mockResolvedValue(bookAtMid(0.50, 10000));
    vi.setSystemTime(12000);
    await tick();
    (deps.clob.getOrderBook as any).mockResolvedValue(bookAtMid(0.55, 10000));
    vi.setSystemTime(13000);
    await tick();

    const firstCallCount = (deps.orderManager.placeOrder as any).mock.calls.filter(
      (c: any[]) => c[0].side === 'buy',
    ).length;
    expect(firstCallCount).toBe(1);

    // Another tick with same market — should not re-enter
    (deps.clob.getOrderBook as any).mockResolvedValue(bookAtMid(0.55, 10000));
    vi.setSystemTime(14000);
    await tick();

    const secondCallCount = (deps.orderManager.placeOrder as any).mock.calls.filter(
      (c: any[]) => c[0].side === 'buy',
    ).length;
    expect(secondCallCount).toBe(1);
  });
});
