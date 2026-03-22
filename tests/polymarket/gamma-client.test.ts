import { describe, it, expect } from 'vitest';
import { parseMarket, parseEvent, type GammaMarket } from '../../src/polymarket/gamma-client.js';

describe('parseMarket', () => {
  it('should parse full market data', () => {
    const raw = {
      id: 'abc-123',
      question: 'Will BTC hit 100k?',
      slug: 'btc-100k',
      conditionId: 'cond-1',
      clobTokenIds: '["token-yes","token-no"]',
      outcomePrices: '["0.65","0.35"]',
      volume: 1000000,
      volume24hr: 50000,
      liquidity: 200000,
      endDate: '2026-12-31',
      active: true,
      closed: false,
      resolved: false,
      outcome: null,
    };
    const market = parseMarket(raw);
    expect(market.id).toBe('abc-123');
    expect(market.question).toBe('Will BTC hit 100k?');
    expect(market.yesTokenId).toBe('token-yes');
    expect(market.noTokenId).toBe('token-no');
    expect(market.yesPrice).toBeCloseTo(0.65);
    expect(market.noPrice).toBeCloseTo(0.35);
    expect(market.volume).toBe(1000000);
    expect(market.volume24h).toBe(50000);
    expect(market.active).toBe(true);
    expect(market.outcome).toBeNull();
  });

  it('should handle missing clobTokenIds', () => {
    const market = parseMarket({ id: 'x' });
    expect(market.yesTokenId).toBe('');
    expect(market.noTokenId).toBeNull();
  });

  it('should handle missing outcomePrices', () => {
    const market = parseMarket({ id: 'x' });
    expect(market.yesPrice).toBe(0.5);
    expect(market.noPrice).toBe(0.5);
  });

  it('should handle null/undefined volume fields', () => {
    const market = parseMarket({ id: 'x', volume: null, volume24hr: undefined });
    expect(market.volume).toBe(0);
    expect(market.volume24h).toBe(0);
  });

  it('should parse outcome when present', () => {
    const market = parseMarket({ id: 'x', outcome: 'Yes' });
    expect(market.outcome).toBe('Yes');
  });

  it('should handle malformed JSON in clobTokenIds', () => {
    const market = parseMarket({ id: 'x', clobTokenIds: 'not-json' });
    expect(market.yesTokenId).toBe('');
  });

  it('should handle single token id', () => {
    const market = parseMarket({ id: 'x', clobTokenIds: '["only-yes"]' });
    expect(market.yesTokenId).toBe('only-yes');
    expect(market.noTokenId).toBeNull();
  });
});

describe('parseEvent', () => {
  it('should parse event with markets', () => {
    const raw = {
      id: 'evt-1',
      title: 'US Elections',
      slug: 'us-elections',
      description: 'All election markets',
      markets: [
        { id: 'm-1', question: 'Who wins?', clobTokenIds: '["t1","t2"]', outcomePrices: '["0.6","0.4"]' },
        { id: 'm-2', question: 'Turnout?', clobTokenIds: '["t3","t4"]', outcomePrices: '["0.7","0.3"]' },
      ],
    };
    const event = parseEvent(raw);
    expect(event.id).toBe('evt-1');
    expect(event.title).toBe('US Elections');
    expect(event.markets).toHaveLength(2);
    expect(event.markets[0].id).toBe('m-1');
  });

  it('should handle empty markets array', () => {
    const event = parseEvent({ id: 'e', title: 't', markets: [] });
    expect(event.markets).toHaveLength(0);
  });

  it('should handle missing markets field', () => {
    const event = parseEvent({ id: 'e', title: 't' });
    expect(event.markets).toHaveLength(0);
  });
});
