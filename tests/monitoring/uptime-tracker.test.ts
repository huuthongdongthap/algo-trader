import { describe, it, expect, beforeEach, vi } from 'vitest';
import { UptimeTracker } from '../../src/monitoring/uptime-tracker.js';

describe('UptimeTracker', () => {
  let tracker: UptimeTracker;

  beforeEach(() => {
    tracker = new UptimeTracker();
    vi.clearAllMocks();
  });

  describe('getUptime', () => {
    it('should return uptime snapshot', () => {
      const snapshot = tracker.getUptime();
      expect(snapshot).toBeTruthy();
      expect(snapshot.startedAt).toBeTruthy();
      expect(snapshot.uptimeSeconds).toBeGreaterThanOrEqual(0);
      expect(typeof snapshot.components).toBe('object');
    });

    it('should record start time as ISO string', () => {
      const snapshot = tracker.getUptime();
      const startDate = new Date(snapshot.startedAt);
      expect(startDate.getTime()).toBeLessThanOrEqual(Date.now());
    });

    it('should calculate positive uptime seconds', () => {
      vi.useFakeTimers();
      const startTime = Date.now();
      vi.setSystemTime(startTime);

      const tracker1 = new UptimeTracker();
      vi.advanceTimersByTime(5000); // 5 seconds
      const snapshot = tracker1.getUptime();

      expect(snapshot.uptimeSeconds).toBeGreaterThanOrEqual(5);
      vi.useRealTimers();
    });

    it('should return empty components initially', () => {
      const snapshot = tracker.getUptime();
      expect(Object.keys(snapshot.components).length).toBe(0);
    });

    it('should include restart reason if set', () => {
      tracker.recordRestart('Scheduled maintenance');
      const snapshot = tracker.getUptime();
      expect(snapshot.lastRestartReason).toBe('Scheduled maintenance');
    });

    it('should omit lastRestartReason if not set', () => {
      const snapshot = tracker.getUptime();
      expect(snapshot.lastRestartReason).toBeUndefined();
    });
  });

  describe('setComponentStatus', () => {
    it('should set component as healthy', () => {
      tracker.setComponentStatus('api', 'healthy');
      const snapshot = tracker.getUptime();
      expect(snapshot.components['api']).toBeTruthy();
      expect(snapshot.components['api'].status).toBe('healthy');
    });

    it('should set component as degraded', () => {
      tracker.setComponentStatus('db', 'degraded', 'Slow queries');
      const snapshot = tracker.getUptime();
      expect(snapshot.components['db'].status).toBe('degraded');
      expect(snapshot.components['db'].detail).toBe('Slow queries');
    });

    it('should set component as down', () => {
      tracker.setComponentStatus('cache', 'down', 'Connection lost');
      const snapshot = tracker.getUptime();
      expect(snapshot.components['cache'].status).toBe('down');
    });

    it('should include lastChecked timestamp', () => {
      tracker.setComponentStatus('ws', 'healthy');
      const snapshot = tracker.getUptime();
      const lastChecked = new Date(snapshot.components['ws'].lastChecked);
      expect(lastChecked.getTime()).toBeLessThanOrEqual(Date.now());
    });

    it('should update existing component status', () => {
      tracker.setComponentStatus('api', 'healthy');
      tracker.setComponentStatus('api', 'degraded', 'Rate limited');
      const snapshot = tracker.getUptime();
      expect(snapshot.components['api'].status).toBe('degraded');
      expect(snapshot.components['api'].detail).toBe('Rate limited');
    });

    it('should track multiple components independently', () => {
      tracker.setComponentStatus('api', 'healthy');
      tracker.setComponentStatus('db', 'degraded');
      tracker.setComponentStatus('cache', 'down');

      const snapshot = tracker.getUptime();
      expect(Object.keys(snapshot.components)).toHaveLength(3);
      expect(snapshot.components['api'].status).toBe('healthy');
      expect(snapshot.components['db'].status).toBe('degraded');
      expect(snapshot.components['cache'].status).toBe('down');
    });

    it('should omit detail if not provided', () => {
      tracker.setComponentStatus('engine', 'healthy');
      const snapshot = tracker.getUptime();
      expect(snapshot.components['engine'].detail).toBeUndefined();
    });

    it('should include detail when provided', () => {
      tracker.setComponentStatus('scheduler', 'degraded', 'Task queue backlog');
      const snapshot = tracker.getUptime();
      expect(snapshot.components['scheduler'].detail).toBe('Task queue backlog');
    });
  });

  describe('recordRestart', () => {
    it('should record restart reason', () => {
      tracker.recordRestart('Memory limit exceeded');
      const snapshot = tracker.getUptime();
      expect(snapshot.lastRestartReason).toBe('Memory limit exceeded');
    });

    it('should allow multiple restart recordings', () => {
      tracker.recordRestart('First restart');
      tracker.recordRestart('Second restart');
      const snapshot = tracker.getUptime();
      expect(snapshot.lastRestartReason).toBe('Second restart');
    });

    it('should work with various restart reasons', () => {
      const reasons = [
        'Scheduled maintenance',
        'Crash recovery',
        'Configuration update',
        'Memory pressure',
      ];

      for (const reason of reasons) {
        tracker.recordRestart(reason);
        const snapshot = tracker.getUptime();
        expect(snapshot.lastRestartReason).toBe(reason);
      }
    });
  });

  describe('integration', () => {
    it('should build complete health report', () => {
      tracker.setComponentStatus('api', 'healthy');
      tracker.setComponentStatus('db', 'healthy');
      tracker.setComponentStatus('cache', 'degraded', 'High latency');
      tracker.recordRestart('Initial startup');

      const snapshot = tracker.getUptime();
      expect(snapshot.startedAt).toBeTruthy();
      expect(snapshot.uptimeSeconds).toBeGreaterThanOrEqual(0);
      expect(Object.keys(snapshot.components)).toHaveLength(3);
      expect(snapshot.lastRestartReason).toBe('Initial startup');
    });

    it('should maintain component status across multiple calls', () => {
      tracker.setComponentStatus('ws', 'healthy');
      let snap1 = tracker.getUptime();
      expect(snap1.components['ws'].status).toBe('healthy');

      tracker.setComponentStatus('ws', 'degraded', 'High latency');
      let snap2 = tracker.getUptime();
      expect(snap2.components['ws'].status).toBe('degraded');
      expect(snap2.components['ws'].detail).toBe('High latency');
    });
  });
});
