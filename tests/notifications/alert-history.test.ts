import { describe, it, expect, beforeEach } from 'vitest';
import { AlertHistory } from '../../src/notifications/alert-history.js';

describe('AlertHistory', () => {
  let history: AlertHistory;

  beforeEach(() => {
    history = new AlertHistory(10); // small ring buffer for testing
  });

  it('should push and retrieve alerts', () => {
    history.push('trade', 'BTC buy executed');
    expect(history.count).toBe(1);
    const recent = history.getRecent(10);
    expect(recent.length).toBe(1);
    expect(recent[0]!.type).toBe('trade');
    expect(recent[0]!.message).toBe('BTC buy executed');
  });

  it('should auto-increment IDs', () => {
    history.push('trade', 'first');
    history.push('alert', 'second');
    const recent = history.getRecent(10);
    expect(recent[0]!.id).toBe(2); // newest first
    expect(recent[1]!.id).toBe(1);
  });

  it('should evict oldest when full (ring buffer)', () => {
    for (let i = 0; i < 15; i++) {
      history.push('trade', `trade-${i}`);
    }
    expect(history.count).toBe(10); // maxSize=10
    const recent = history.getRecent(10);
    expect(recent[0]!.message).toBe('trade-14'); // newest
    expect(recent[9]!.message).toBe('trade-5');  // oldest surviving
  });

  it('should filter by type', () => {
    history.push('trade', 'trade-1');
    history.push('alert', 'alert-1');
    history.push('error', 'error-1');
    history.push('trade', 'trade-2');

    const trades = history.getByType('trade');
    expect(trades.length).toBe(2);
    expect(trades[0]!.message).toBe('trade-2');

    const alerts = history.getByType('alert');
    expect(alerts.length).toBe(1);
  });

  it('should filter by since timestamp', () => {
    const now = Date.now();
    history.push('trade', 'old-trade');
    // All pushes use Date.now() internally, so all should be >= now
    const results = history.getSince(now);
    expect(results.length).toBeGreaterThanOrEqual(1);
  });

  it('should return available types', () => {
    history.push('trade', 't');
    history.push('alert', 'a');
    history.push('error', 'e');
    history.push('trade', 't2');

    const types = history.getTypes();
    expect(types).toContain('trade');
    expect(types).toContain('alert');
    expect(types).toContain('error');
    expect(types.length).toBe(3);
  });

  it('should return empty arrays when no data', () => {
    expect(history.getRecent(10)).toEqual([]);
    expect(history.getByType('trade')).toEqual([]);
    expect(history.getSince(0)).toEqual([]);
    expect(history.getTypes()).toEqual([]);
    expect(history.count).toBe(0);
  });

  it('should store metadata', () => {
    history.push('trade', 'BTC buy', { marketId: 'BTC-USD', strategy: 'grid' });
    const recent = history.getRecent(1);
    expect(recent[0]!.metadata).toEqual({ marketId: 'BTC-USD', strategy: 'grid' });
  });

  it('should respect limit in getRecent', () => {
    for (let i = 0; i < 5; i++) history.push('trade', `t-${i}`);
    const recent = history.getRecent(2);
    expect(recent.length).toBe(2);
    expect(recent[0]!.message).toBe('t-4');
  });

  it('should default maxSize to 500', () => {
    const largeHistory = new AlertHistory();
    for (let i = 0; i < 510; i++) largeHistory.push('trade', `t-${i}`);
    expect(largeHistory.count).toBe(500);
  });
});
