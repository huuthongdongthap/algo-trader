import { describe, it, expect } from 'vitest';
import { PriceFeed } from '../../src/data/price-feed.js';
import type { PriceTick } from '../../src/data/price-feed.js';

function makeTick(market: string, source: string, bid: number, ask: number): PriceTick {
  const mid = ((bid + ask) / 2).toFixed(6);
  const spread = (ask - bid).toFixed(6);
  return { market, source, bid: String(bid), ask: String(ask), mid, spread, timestamp: Date.now() };
}

describe('PriceFeed', () => {
  it('should push and retrieve ticks', () => {
    const feed = new PriceFeed();
    feed.pushTick(makeTick('BTC', 'binance', 50000, 50010));
    const history = feed.getPriceHistory('BTC');
    expect(history.length).toBe(1);
    expect(history[0].source).toBe('binance');
  });

  it('should return empty history for unknown market', () => {
    const feed = new PriceFeed();
    expect(feed.getPriceHistory('UNKNOWN').length).toBe(0);
  });

  it('should aggregate latest price from multiple sources', () => {
    const feed = new PriceFeed();
    feed.pushTick(makeTick('BTC', 'binance', 50000, 50010));
    feed.pushTick(makeTick('BTC', 'polymarket', 49990, 50020));

    const agg = feed.getLatestPrice('BTC');
    expect(agg).not.toBeNull();
    expect(agg!.ticks.length).toBe(2);
    expect(parseFloat(agg!.bestBid)).toBe(50000); // max bid
    expect(parseFloat(agg!.bestAsk)).toBe(50010); // min ask
  });

  it('should return null for no ticks', () => {
    const feed = new PriceFeed();
    expect(feed.getLatestPrice('NONE')).toBeNull();
  });

  it('should emit tick event', () => {
    const feed = new PriceFeed();
    let received = false;
    feed.on('tick', (tick: PriceTick) => {
      expect(tick.market).toBe('ETH');
      received = true;
    });
    feed.pushTick(makeTick('ETH', 'binance', 3000, 3001));
    expect(received).toBe(true);
  });

  it('should emit market-specific tick event', () => {
    const feed = new PriceFeed();
    let received = false;
    feed.on('tick:SOL', (tick: PriceTick) => {
      received = true;
    });
    feed.pushTick(makeTick('SOL', 'binance', 100, 101));
    expect(received).toBe(true);
  });

  it('should limit history by capacity', () => {
    const feed = new PriceFeed(5); // cap at 5
    for (let i = 0; i < 10; i++) {
      feed.pushTick(makeTick('BTC', 'test', 100 + i, 101 + i));
    }
    expect(feed.getPriceHistory('BTC').length).toBe(5);
  });

  it('should add and remove sources', () => {
    const feed = new PriceFeed();
    feed.addSource('test', async () => null, 10000);
    feed.removeSource('test');
    // No error removing non-existent
    feed.removeSource('nonexistent');
  });

  it('should compute VWAP from multiple sources', () => {
    const feed = new PriceFeed();
    feed.pushTick({ ...makeTick('BTC', 'a', 100, 102), volume: '1000' });
    feed.pushTick({ ...makeTick('BTC', 'b', 99, 103), volume: '500' });
    const agg = feed.getLatestPrice('BTC');
    expect(agg).not.toBeNull();
    expect(parseFloat(agg!.vwap)).toBeGreaterThan(0);
  });
});
