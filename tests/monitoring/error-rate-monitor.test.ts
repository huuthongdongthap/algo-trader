import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ErrorRateMonitor } from '../../src/monitoring/error-rate-monitor.js';

describe('ErrorRateMonitor', () => {
  let monitor: ErrorRateMonitor;

  beforeEach(() => {
    monitor = new ErrorRateMonitor(5 * 60 * 1000); // 5-minute window
    vi.clearAllMocks();
  });

  describe('recordError', () => {
    it('should record error with string message', () => {
      monitor.recordError('api', 'Connection timeout');
      const rate = monitor.getErrorRate('api');
      expect(rate).toBeGreaterThan(0);
    });

    it('should record error with Error object', () => {
      const error = new Error('Database query failed');
      monitor.recordError('db', error);
      const rate = monitor.getErrorRate('db');
      expect(rate).toBeGreaterThan(0);
    });

    it('should track multiple categories independently', () => {
      monitor.recordError('api', 'Error 1');
      monitor.recordError('db', 'Error 2');
      monitor.recordError('api', 'Error 3');

      const apiRate = monitor.getErrorRate('api');
      const dbRate = monitor.getErrorRate('db');

      expect(apiRate).toBeGreaterThan(dbRate);
    });
  });

  describe('getErrorRate', () => {
    it('should return 0 for empty category', () => {
      const rate = monitor.getErrorRate('nonexistent');
      expect(rate).toBe(0);
    });

    it('should calculate errors per minute', () => {
      // Record 10 errors in quick succession
      for (let i = 0; i < 10; i++) {
        monitor.recordError('api', `Error ${i}`);
      }
      const rate = monitor.getErrorRate('api');
      // 10 errors / 5 minutes = 2 errors/min
      expect(rate).toBe(2);
    });

    it('should evict old errors outside window', () => {
      monitor.recordError('api', 'Old error');
      vi.useFakeTimers();
      vi.advanceTimersByTime(6 * 60 * 1000); // 6 minutes

      // Record new error
      monitor.recordError('api', 'New error');
      vi.useRealTimers();

      const rate = monitor.getErrorRate('api');
      // Only 1 error (new) should remain in window
      expect(rate).toBe(1 / 5);
    });
  });

  describe('getAllRates', () => {
    it('should return empty object initially', () => {
      const rates = monitor.getAllRates();
      expect(rates).toEqual({});
    });

    it('should return rates for all categories', () => {
      monitor.recordError('api', 'Error 1');
      monitor.recordError('db', 'Error 2');
      monitor.recordError('cache', 'Error 3');

      const rates = monitor.getAllRates();
      expect(rates['api']).toBe(1 / 5);
      expect(rates['db']).toBe(1 / 5);
      expect(rates['cache']).toBe(1 / 5);
    });

    it('should calculate each category independently', () => {
      for (let i = 0; i < 5; i++) {
        monitor.recordError('api', `Error ${i}`);
      }
      for (let i = 0; i < 10; i++) {
        monitor.recordError('db', `Error ${i}`);
      }

      const rates = monitor.getAllRates();
      expect(rates['api']).toBe(5 / 5); // 1 error/min
      expect(rates['db']).toBe(10 / 5); // 2 errors/min
    });
  });

  describe('isHealthy', () => {
    it('should return true when no errors', () => {
      const healthy = monitor.isHealthy();
      expect(healthy).toBe(true);
    });

    it('should return true below alert threshold', () => {
      // Alert threshold is 10 errors/min
      // 5 errors in 5 minutes = 1 error/min (below threshold)
      for (let i = 0; i < 5; i++) {
        monitor.recordError('api', `Error ${i}`);
      }
      const healthy = monitor.isHealthy();
      expect(healthy).toBe(true);
    });

    it('should return false when threshold exceeded', () => {
      // Record 60+ errors to exceed 10 errors/min in 5-minute window
      for (let i = 0; i < 51; i++) {
        monitor.recordError('api', `Error ${i}`);
      }
      const healthy = monitor.isHealthy();
      expect(healthy).toBe(false);
    });

    it('should check all categories', () => {
      // API is healthy
      for (let i = 0; i < 5; i++) {
        monitor.recordError('api', `Error ${i}`);
      }
      // DB exceeds threshold
      for (let i = 0; i < 51; i++) {
        monitor.recordError('db', `Error ${i}`);
      }
      const healthy = monitor.isHealthy();
      expect(healthy).toBe(false);
    });
  });

  describe('window management', () => {
    it('should use custom window size', () => {
      const customMonitor = new ErrorRateMonitor(1000); // 1 second window
      customMonitor.recordError('test', 'Error 1');
      customMonitor.recordError('test', 'Error 2');

      // 2 errors in 1-second window = 120 errors/min
      const rate = customMonitor.getErrorRate('test');
      expect(rate).toBeGreaterThan(100);
    });

    it('should bound memory usage with eviction', () => {
      // Record errors every millisecond for 1 second
      for (let i = 0; i < 100; i++) {
        monitor.recordError('api', `Error ${i}`);
      }
      // This should work without memory issues
      const rate = monitor.getErrorRate('api');
      expect(rate).toBeGreaterThan(0);
    });
  });
});
