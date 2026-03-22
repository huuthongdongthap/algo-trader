import { describe, it, expect } from 'vitest';
import {
  recordAiCall,
  getAiUsage,
  canMakeAiCall,
  getAllAiUsage,
} from '../../src/openclaw/ai-usage-meter.js';

describe('AI Usage Meter', () => {
  // Note: module-level Map persists across tests in same run.
  // Use unique userIds per test to avoid interference.

  it('should start with zero usage', () => {
    const usage = getAiUsage('user-fresh-1');
    expect(usage.callCount).toBe(0);
    expect(usage.tokenCount).toBe(0);
    expect(usage.lastCallAt).toBe(0);
  });

  it('should record AI calls and accumulate', () => {
    recordAiCall('meter-user-1', 500);
    recordAiCall('meter-user-1', 300);
    const usage = getAiUsage('meter-user-1');
    expect(usage.callCount).toBe(2);
    expect(usage.tokenCount).toBe(800);
    expect(usage.lastCallAt).toBeGreaterThan(0);
  });

  it('should enforce free tier (0 calls allowed)', () => {
    const result = canMakeAiCall('meter-free-1', 'free');
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
    expect(result.limit).toBe(0);
  });

  it('should enforce pro tier (100 calls/month)', () => {
    const result = canMakeAiCall('meter-pro-1', 'pro');
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(100);
    expect(result.limit).toBe(100);
  });

  it('should decrement remaining after recording calls', () => {
    for (let i = 0; i < 5; i++) recordAiCall('meter-pro-2', 100);
    const result = canMakeAiCall('meter-pro-2', 'pro');
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(95);
  });

  it('should allow enterprise tier unlimited calls', () => {
    for (let i = 0; i < 200; i++) recordAiCall('meter-ent-1', 1000);
    const result = canMakeAiCall('meter-ent-1', 'enterprise');
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(Infinity);
    expect(result.limit).toBe(Infinity);
  });

  it('should return all usage sorted by callCount desc', () => {
    recordAiCall('meter-sort-a', 10);
    recordAiCall('meter-sort-b', 10);
    recordAiCall('meter-sort-b', 10);
    const all = getAllAiUsage();
    expect(all.length).toBeGreaterThanOrEqual(2);
    // Should be sorted desc by callCount
    for (let i = 1; i < all.length; i++) {
      expect(all[i - 1].callCount).toBeGreaterThanOrEqual(all[i].callCount);
    }
  });

  it('should track separate users independently', () => {
    recordAiCall('meter-iso-a', 100);
    recordAiCall('meter-iso-b', 200);
    expect(getAiUsage('meter-iso-a').tokenCount).toBe(100);
    expect(getAiUsage('meter-iso-b').tokenCount).toBe(200);
  });
});
