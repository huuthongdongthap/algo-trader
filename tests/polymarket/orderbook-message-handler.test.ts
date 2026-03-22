import { describe, it, expect } from 'vitest';
import {
  applySnapshot,
  applyDelta,
  calcSpread,
  parseMessage,
  type OrderBookState,
  type WsSnapshot,
  type WsDelta,
} from '../../src/polymarket/orderbook-message-handler.js';

function makeBook(overrides: Partial<OrderBookState> = {}): OrderBookState {
  return {
    tokenId: 'token-1',
    bids: [{ price: '0.60', size: '100' }, { price: '0.59', size: '200' }],
    asks: [{ price: '0.61', size: '100' }, { price: '0.62', size: '200' }],
    updatedAt: Date.now(),
    ...overrides,
  };
}

describe('applySnapshot', () => {
  it('should create book state from snapshot', () => {
    const snap: WsSnapshot = {
      event_type: 'book',
      asset_id: 'token-1',
      bids: [{ price: '0.55', size: '50' }, { price: '0.60', size: '100' }],
      asks: [{ price: '0.65', size: '80' }, { price: '0.61', size: '120' }],
    };
    const state = applySnapshot(snap, undefined);
    expect(state.tokenId).toBe('token-1');
    // Bids sorted desc by price
    expect(state.bids[0].price).toBe('0.60');
    expect(state.bids[1].price).toBe('0.55');
    // Asks sorted asc by price
    expect(state.asks[0].price).toBe('0.61');
    expect(state.asks[1].price).toBe('0.65');
  });

  it('should replace previous book', () => {
    const prev = makeBook();
    const snap: WsSnapshot = {
      event_type: 'book',
      asset_id: 'token-1',
      bids: [{ price: '0.70', size: '300' }],
      asks: [{ price: '0.71', size: '300' }],
    };
    const state = applySnapshot(snap, prev);
    expect(state.bids).toHaveLength(1);
    expect(state.bids[0].price).toBe('0.70');
  });

  it('should set updatedAt', () => {
    const before = Date.now();
    const state = applySnapshot({
      event_type: 'book', asset_id: 't', bids: [], asks: [],
    }, undefined);
    expect(state.updatedAt).toBeGreaterThanOrEqual(before);
  });
});

describe('applyDelta', () => {
  it('should update existing price level', () => {
    const book = makeBook();
    const delta: WsDelta = {
      event_type: 'price_change',
      asset_id: 'token-1',
      changes: [{ side: 'BUY', price: '0.60', size: '999' }],
    };
    applyDelta(delta, book);
    expect(book.bids.find(b => b.price === '0.60')?.size).toBe('999');
  });

  it('should add new price level', () => {
    const book = makeBook();
    const delta: WsDelta = {
      event_type: 'price_change',
      asset_id: 'token-1',
      changes: [{ side: 'BUY', price: '0.58', size: '50' }],
    };
    applyDelta(delta, book);
    expect(book.bids.some(b => b.price === '0.58')).toBe(true);
    // Should remain sorted desc
    expect(book.bids[book.bids.length - 1].price).toBe('0.58');
  });

  it('should remove level when size is 0', () => {
    const book = makeBook();
    const delta: WsDelta = {
      event_type: 'price_change',
      asset_id: 'token-1',
      changes: [{ side: 'BUY', price: '0.60', size: '0' }],
    };
    applyDelta(delta, book);
    expect(book.bids.find(b => b.price === '0.60')).toBeUndefined();
  });

  it('should handle SELL side changes', () => {
    const book = makeBook();
    const delta: WsDelta = {
      event_type: 'price_change',
      asset_id: 'token-1',
      changes: [{ side: 'SELL', price: '0.61', size: '500' }],
    };
    applyDelta(delta, book);
    expect(book.asks.find(a => a.price === '0.61')?.size).toBe('500');
  });

  it('should re-sort after delta', () => {
    const book = makeBook();
    applyDelta({
      event_type: 'price_change',
      asset_id: 'token-1',
      changes: [{ side: 'SELL', price: '0.60', size: '10' }],
    }, book);
    // 0.60 should be first ask (lowest)
    expect(book.asks[0].price).toBe('0.60');
  });

  it('should ignore removal of non-existent level', () => {
    const book = makeBook();
    const before = book.bids.length;
    applyDelta({
      event_type: 'price_change',
      asset_id: 'token-1',
      changes: [{ side: 'BUY', price: '0.99', size: '0' }],
    }, book);
    expect(book.bids.length).toBe(before);
  });
});

describe('calcSpread', () => {
  it('should calculate spread from best bid/ask', () => {
    const book = makeBook();
    expect(calcSpread(book)).toBeCloseTo(0.01, 4);
  });

  it('should return 0 for empty bids', () => {
    const book = makeBook({ bids: [] });
    expect(calcSpread(book)).toBe(0);
  });

  it('should return 0 for empty asks', () => {
    const book = makeBook({ asks: [] });
    expect(calcSpread(book)).toBe(0);
  });

  it('should return 0 for empty book', () => {
    expect(calcSpread(makeBook({ bids: [], asks: [] }))).toBe(0);
  });
});

describe('parseMessage', () => {
  it('should parse valid JSON', () => {
    const msg = parseMessage('{"event_type":"book","asset_id":"t","bids":[],"asks":[]}');
    expect(msg?.event_type).toBe('book');
  });

  it('should return null for invalid JSON', () => {
    expect(parseMessage('not json')).toBeNull();
  });

  it('should return null for empty string', () => {
    expect(parseMessage('')).toBeNull();
  });

  it('should parse heartbeat', () => {
    const msg = parseMessage('{"event_type":"heartbeat"}');
    expect(msg?.event_type).toBe('heartbeat');
  });

  it('should parse price_change', () => {
    const msg = parseMessage('{"event_type":"price_change","asset_id":"t","changes":[]}');
    expect(msg?.event_type).toBe('price_change');
  });
});
