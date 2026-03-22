import { describe, it, expect } from 'vitest';
import {
  paperMarkets,
  paperOrderBook,
  paperPrice,
} from '../../src/polymarket/clob-paper-simulator.js';

describe('paperMarkets', () => {
  it('should return array of paper markets', () => {
    const markets = paperMarkets();
    expect(markets).toHaveLength(1);
    expect(markets[0].condition_id).toBe('paper-condition-1');
    expect(markets[0].active).toBe(true);
  });

  it('should have yes and no tokens', () => {
    const market = paperMarkets()[0];
    expect(market.tokens).toHaveLength(2);
    expect(market.tokens[0].outcome).toBe('Yes');
    expect(market.tokens[1].outcome).toBe('No');
  });

  it('should have valid volume', () => {
    const market = paperMarkets()[0];
    expect(parseFloat(market.volume)).toBeGreaterThan(0);
  });
});

describe('paperOrderBook', () => {
  it('should return book for yes token with higher mid', () => {
    const book = paperOrderBook('paper-yes-1');
    expect(book.asset_id).toBe('paper-yes-1');
    expect(book.bids.length).toBeGreaterThan(0);
    expect(book.asks.length).toBeGreaterThan(0);
    // Yes token mid = 0.6
    expect(parseFloat(book.bids[0].price)).toBeCloseTo(0.59, 2);
    expect(parseFloat(book.asks[0].price)).toBeCloseTo(0.61, 2);
  });

  it('should return book for no token with lower mid', () => {
    const book = paperOrderBook('paper-no-1');
    // No token mid = 0.4
    expect(parseFloat(book.bids[0].price)).toBeCloseTo(0.39, 2);
    expect(parseFloat(book.asks[0].price)).toBeCloseTo(0.41, 2);
  });

  it('should have 2 levels on each side', () => {
    const book = paperOrderBook('paper-yes-1');
    expect(book.bids).toHaveLength(2);
    expect(book.asks).toHaveLength(2);
  });

  it('should have valid sizes', () => {
    const book = paperOrderBook('paper-yes-1');
    for (const level of [...book.bids, ...book.asks]) {
      expect(parseFloat(level.size)).toBeGreaterThan(0);
    }
  });
});

describe('paperPrice', () => {
  it('should return yes token price around 0.6', () => {
    const price = paperPrice('paper-yes-1');
    expect(parseFloat(price.mid)).toBeCloseTo(0.6, 2);
    expect(parseFloat(price.bid)).toBeLessThan(parseFloat(price.mid));
    expect(parseFloat(price.ask)).toBeGreaterThan(parseFloat(price.mid));
  });

  it('should return no token price around 0.4', () => {
    const price = paperPrice('paper-no-1');
    expect(parseFloat(price.mid)).toBeCloseTo(0.4, 2);
  });

  it('should have spread of 0.02', () => {
    const price = paperPrice('paper-yes-1');
    const spread = parseFloat(price.ask) - parseFloat(price.bid);
    expect(spread).toBeCloseTo(0.02, 4);
  });
});
