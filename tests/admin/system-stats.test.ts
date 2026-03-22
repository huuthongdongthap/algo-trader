import { describe, it, expect } from 'vitest';
import { formatUptime, getResourceUsage } from '../../src/admin/system-stats.js';

describe('formatUptime', () => {
  it('should format seconds only', () => {
    expect(formatUptime(5000)).toBe('5s');
  });

  it('should format minutes and seconds', () => {
    expect(formatUptime(90_000)).toBe('1m 30s');
  });

  it('should format hours, minutes, seconds', () => {
    expect(formatUptime(3_661_000)).toBe('1h 1m 1s');
  });

  it('should format days', () => {
    expect(formatUptime(86_400_000 + 3_600_000 + 60_000 + 1000)).toBe('1d 1h 1m 1s');
  });

  it('should skip zero segments', () => {
    expect(formatUptime(3_600_000)).toBe('1h 0s');
  });

  it('should handle 0ms', () => {
    expect(formatUptime(0)).toBe('0s');
  });
});

describe('getResourceUsage', () => {
  it('should return memory and CPU metrics', () => {
    const usage = getResourceUsage();
    expect(usage.memoryRssMb).toBeGreaterThan(0);
    expect(usage.heapUsedMb).toBeGreaterThan(0);
    expect(usage.heapTotalMb).toBeGreaterThan(0);
    expect(typeof usage.cpuUserMs).toBe('number');
    expect(typeof usage.cpuSystemMs).toBe('number');
  });

  it('should return heap used <= heap total', () => {
    const usage = getResourceUsage();
    expect(usage.heapUsedMb).toBeLessThanOrEqual(usage.heapTotalMb);
  });
});
