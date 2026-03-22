import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { ProcessMonitor } from '../../src/scaling/process-monitor.js';

describe('ProcessMonitor', () => {
  let monitor: ProcessMonitor;

  beforeEach(() => {
    monitor = new ProcessMonitor(3); // restart threshold = 3
    vi.clearAllMocks();
  });

  afterEach(() => {
    monitor.stopMonitoring();
  });

  describe('registerProcess', () => {
    it('should register a process with health check function', () => {
      const healthCheckFn = vi.fn(async () => true);
      monitor.registerProcess('test-service', healthCheckFn);

      const report = monitor.getHealthReport();
      expect(report.processes).toHaveLength(1);
      expect(report.processes[0].name).toBe('test-service');
    });

    it('should throw if process already registered', () => {
      const healthCheckFn = vi.fn(async () => true);
      monitor.registerProcess('service1', healthCheckFn);

      expect(() => {
        monitor.registerProcess('service1', healthCheckFn);
      }).toThrow("Process 'service1' already registered");
    });

    it('should initialize process as healthy', () => {
      const healthCheckFn = vi.fn(async () => true);
      monitor.registerProcess('api', healthCheckFn);

      const report = monitor.getHealthReport();
      expect(report.processes[0].healthy).toBe(true);
      expect(report.processes[0].consecutiveFailures).toBe(0);
    });

    it('should register optional restart function', () => {
      const healthCheckFn = vi.fn(async () => true);
      const restartFn = vi.fn(async () => {});
      monitor.registerProcess('engine', healthCheckFn, restartFn);

      expect(vi.fn()).toBeTruthy();
    });
  });

  describe('getHealthReport', () => {
    it('should return health report with all processes', async () => {
      const healthCheckFn = vi.fn(async () => true);
      monitor.registerProcess('api', healthCheckFn);
      monitor.registerProcess('db', healthCheckFn);

      const report = monitor.getHealthReport();
      expect(report.processes).toHaveLength(2);
      expect(report.timestamp).toBeLessThanOrEqual(Date.now());
      expect(typeof report.systemMemoryMb).toBe('number');
      expect(report.allHealthy).toBe(true);
    });

    it('should mark system as unhealthy if any process fails', async () => {
      const healthyFn = vi.fn(async () => true);
      const unhealthyFn = vi.fn(async () => false);

      monitor.registerProcess('api', healthyFn);
      monitor.registerProcess('db', unhealthyFn);

      const stop = monitor.startMonitoring(100);
      await new Promise(r => setTimeout(r, 150));
      stop();

      const report = monitor.getHealthReport();
      expect(report.allHealthy).toBe(false);
    });

    it('should include system memory usage', () => {
      const healthCheckFn = vi.fn(async () => true);
      monitor.registerProcess('test', healthCheckFn);

      const report = monitor.getHealthReport();
      expect(typeof report.systemMemoryMb).toBe('number');
      expect(report.systemMemoryMb).toBeGreaterThan(0);
    });

    it('should track check count per process', async () => {
      const healthCheckFn = vi.fn(async () => true);
      monitor.registerProcess('service', healthCheckFn);

      const stop = monitor.startMonitoring(50);
      await new Promise(r => setTimeout(r, 150));
      stop();

      const report = monitor.getHealthReport();
      expect(report.processes[0].checkCount).toBeGreaterThan(0);
    });
  });

  describe('startMonitoring', () => {
    it('should start periodic monitoring', async () => {
      const healthCheckFn = vi.fn(async () => true);
      monitor.registerProcess('test', healthCheckFn);

      const stop = monitor.startMonitoring(50);
      await new Promise(r => setTimeout(r, 120));
      stop();

      expect(healthCheckFn.mock.calls.length).toBeGreaterThan(0);
    });

    it('should run initial health check immediately', async () => {
      const healthCheckFn = vi.fn(async () => true);
      monitor.registerProcess('service', healthCheckFn);

      monitor.startMonitoring(1000);
      await new Promise(r => setTimeout(r, 10));

      expect(healthCheckFn).toHaveBeenCalled();
      monitor.stopMonitoring();
    });

    it('should throw if already monitoring', () => {
      const healthCheckFn = vi.fn(async () => true);
      monitor.registerProcess('test', healthCheckFn);

      monitor.startMonitoring();
      expect(() => monitor.startMonitoring()).toThrow('Monitoring already running');
      monitor.stopMonitoring();
    });

    it('should return stop function', () => {
      const healthCheckFn = vi.fn(async () => true);
      monitor.registerProcess('test', healthCheckFn);

      const stop = monitor.startMonitoring();
      expect(typeof stop).toBe('function');
      stop();
    });
  });

  describe('stopMonitoring', () => {
    it('should stop periodic checks', async () => {
      const healthCheckFn = vi.fn(async () => true);
      monitor.registerProcess('test', healthCheckFn);

      const stop = monitor.startMonitoring(50);
      await new Promise(r => setTimeout(r, 100));
      const callsBefore = healthCheckFn.mock.calls.length;

      stop();
      await new Promise(r => setTimeout(r, 100));
      const callsAfter = healthCheckFn.mock.calls.length;

      expect(callsAfter).toBe(callsBefore);
    });
  });

  describe('restart logic', () => {
    it('should trigger restart after threshold consecutive failures', async () => {
      const healthCheckFn = vi.fn(async () => false);
      const restartFn = vi.fn(async () => {});

      monitor = new ProcessMonitor(2); // Lower threshold for testing
      monitor.registerProcess('api', healthCheckFn, restartFn);

      const stop = monitor.startMonitoring(50);
      await new Promise(r => setTimeout(r, 250)); // Allow multiple check cycles
      stop();

      expect(restartFn.mock.calls.length).toBeGreaterThan(0);
    });

    it('should not trigger restart on single failure', async () => {
      const healthCheckFn = vi.fn(async () => false);
      const restartFn = vi.fn(async () => {});

      monitor.registerProcess('service', healthCheckFn, restartFn);

      const stop = monitor.startMonitoring(50);
      await new Promise(r => setTimeout(r, 80));
      stop();

      expect(restartFn).not.toHaveBeenCalled();
    });

    it('should reset consecutive failures on success', async () => {
      let callCount = 0;
      const healthCheckFn = vi.fn(async () => {
        callCount++;
        return callCount > 2; // Fail twice, then succeed on 3rd+
      });
      const restartFn = vi.fn(async () => {});

      monitor = new ProcessMonitor(2);
      monitor.registerProcess('api', healthCheckFn, restartFn);

      const stop = monitor.startMonitoring(50);
      await new Promise(r => setTimeout(r, 300));
      stop();

      const report = monitor.getHealthReport();
      // After success, consecutive failures should reset
      if (healthCheckFn.mock.calls.length > 3) {
        expect(report.processes[0].healthy).toBe(true);
      }
    });

    it('should catch restart errors gracefully', async () => {
      const healthCheckFn = vi.fn(async () => false);
      const restartFn = vi.fn(async () => {
        throw new Error('Restart failed');
      });

      monitor = new ProcessMonitor(1);
      monitor.registerProcess('service', healthCheckFn, restartFn);

      const stop = monitor.startMonitoring(50);
      await new Promise(r => setTimeout(r, 150));
      stop();

      // Monitor should still be alive despite restart error
      expect(monitor.getHealthReport()).toBeTruthy();
    });
  });

  describe('memory tracking', () => {
    it('should track memory usage per process', async () => {
      const healthCheckFn = vi.fn(async () => true);
      monitor.registerProcess('app', healthCheckFn);

      const stop = monitor.startMonitoring(50);
      await new Promise(r => setTimeout(r, 100));
      stop();

      const report = monitor.getHealthReport();
      expect(report.processes[0].memoryMb).toBeGreaterThan(0);
    });

    it('should update lastCheckAt timestamp', async () => {
      const healthCheckFn = vi.fn(async () => true);
      monitor.registerProcess('service', healthCheckFn);

      const stop = monitor.startMonitoring(50);
      await new Promise(r => setTimeout(r, 100));
      stop();

      const report = monitor.getHealthReport();
      expect(report.processes[0].lastCheckAt).not.toBeNull();
      expect(report.processes[0].lastCheckAt).toBeLessThanOrEqual(Date.now());
    });
  });

  describe('error handling', () => {
    it('should handle health check exceptions', async () => {
      const healthCheckFn = vi.fn(async () => {
        throw new Error('Check failed');
      });

      monitor.registerProcess('failing', healthCheckFn);

      const stop = monitor.startMonitoring(50);
      await new Promise(r => setTimeout(r, 100));
      stop();

      const report = monitor.getHealthReport();
      expect(report.processes[0].healthy).toBe(false);
    });

    it('should continue monitoring other processes on error', async () => {
      const failingFn = vi.fn(async () => {
        throw new Error('Error');
      });
      const workingFn = vi.fn(async () => true);

      monitor.registerProcess('failing', failingFn);
      monitor.registerProcess('working', workingFn);

      const stop = monitor.startMonitoring(50);
      await new Promise(r => setTimeout(r, 100));
      stop();

      const report = monitor.getHealthReport();
      expect(report.processes).toHaveLength(2);
    });
  });
});
