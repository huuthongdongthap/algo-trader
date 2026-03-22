import { describe, it, expect, afterEach } from 'vitest';
import { UsageTracker } from '../../src/metering/usage-tracker.js';

describe('UsageTracker', () => {
  let tracker: UsageTracker;

  afterEach(() => {
    tracker?.destroy();
  });

  it('should record and retrieve usage', () => {
    tracker = new UsageTracker();
    tracker.recordCall('u1', '/api/signals', 50);
    tracker.recordCall('u1', '/api/signals', 30);
    expect(tracker.getUsage('u1', 60_000)).toBe(2);
  });

  it('should return 0 for unknown user', () => {
    tracker = new UsageTracker();
    expect(tracker.getUsage('nobody', 60_000)).toBe(0);
  });

  it('should compute endpoint breakdown', () => {
    tracker = new UsageTracker();
    tracker.recordCall('u1', '/api/signals', 10);
    tracker.recordCall('u1', '/api/signals', 20);
    tracker.recordCall('u1', '/api/trades', 15);
    const breakdown = tracker.getEndpointBreakdown('u1');
    expect(breakdown['/api/signals']).toBe(2);
    expect(breakdown['/api/trades']).toBe(1);
  });

  it('should list active users', () => {
    tracker = new UsageTracker();
    tracker.recordCall('u1', '/api/x', 10);
    tracker.recordCall('u2', '/api/y', 20);
    const active = tracker.getActiveUsers(60_000);
    expect(active).toContain('u1');
    expect(active).toContain('u2');
  });

  it('should return raw user records', () => {
    tracker = new UsageTracker();
    tracker.recordCall('u1', '/api/x', 42);
    const records = tracker.getUserRecords('u1');
    expect(records.length).toBe(1);
    expect(records[0].endpoint).toBe('/api/x');
    expect(records[0].responseTimeMs).toBe(42);
  });

  it('should list all user IDs', () => {
    tracker = new UsageTracker();
    tracker.recordCall('u1', '/api/x', 10);
    tracker.recordCall('u2', '/api/x', 10);
    expect(tracker.getAllUserIds()).toContain('u1');
    expect(tracker.getAllUserIds()).toContain('u2');
  });

  it('should handle destroy gracefully', () => {
    tracker = new UsageTracker();
    tracker.destroy();
    tracker.destroy(); // double destroy should be safe
  });
});
