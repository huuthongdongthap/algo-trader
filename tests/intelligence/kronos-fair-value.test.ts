import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getKronosFairValue } from '../../src/intelligence/kronos-fair-value.js';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

describe('getKronosFairValue', () => {
  beforeEach(() => fetchMock.mockReset());
  afterEach(() => vi.restoreAllMocks());

  const makePrices = (len: number, start = 0.5, step = 0.001) =>
    Array.from({ length: len }, (_, i) => start + i * step);

  it('returns null for insufficient history', async () => {
    const result = await getKronosFairValue([0.5, 0.51, 0.52]);
    expect(result).toBeNull();
  });

  it('returns forecast with direction and confidence', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      forecast: [
        { close: 0.58, high: 0.60, low: 0.56 },
        { close: 0.59, high: 0.61, low: 0.57 },
        { close: 0.60, high: 0.62, low: 0.58 },
      ],
      model: 'kronos', device: 'mps',
    }), { status: 200 }));

    const prices = makePrices(40, 0.50, 0.002);
    const result = await getKronosFairValue(prices);

    expect(result).not.toBeNull();
    expect(result!.predictedPrice).toBeCloseTo(0.59, 1);
    expect(result!.direction).toBe('up');
    expect(result!.confidence).toBeGreaterThan(0);
    expect(result!.confidence).toBeLessThanOrEqual(1);
    expect(result!.priceRange.low).toBeLessThan(result!.priceRange.high);
  });

  it('returns "flat" direction for minimal change', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      forecast: [
        { close: 0.500, high: 0.505, low: 0.495 },
        { close: 0.501, high: 0.506, low: 0.496 },
      ],
      model: 'kronos', device: 'cpu',
    }), { status: 200 }));

    const prices = makePrices(35, 0.50, 0.0001);
    const result = await getKronosFairValue(prices);

    expect(result).not.toBeNull();
    expect(result!.direction).toBe('flat');
  });

  it('returns null when sidecar unavailable', async () => {
    fetchMock.mockRejectedValueOnce(new Error('connection refused'));
    const prices = makePrices(40);
    const result = await getKronosFairValue(prices);
    expect(result).toBeNull();
  });

  it('returns "down" direction for declining forecast', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      forecast: [
        { close: 0.42, high: 0.44, low: 0.40 },
        { close: 0.40, high: 0.42, low: 0.38 },
      ],
      model: 'kronos', device: 'mps',
    }), { status: 200 }));

    const prices = makePrices(50, 0.50, -0.001);
    const result = await getKronosFairValue(prices);

    expect(result).not.toBeNull();
    expect(result!.direction).toBe('down');
  });
});
