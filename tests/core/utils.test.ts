import { describe, it, expect, vi } from 'vitest';
import {
  sleep,
  retry,
  formatPrice,
  percentChange,
  formatUsdc,
  generateId,
  clamp,
  safeParseFloat,
} from '../../src/core/utils.js';

describe('sleep', () => {
  it('should resolve after specified milliseconds', async () => {
    const start = Date.now();
    await sleep(100);
    const elapsed = Date.now() - start;
    // Allow some tolerance (90-150ms)
    expect(elapsed).toBeGreaterThanOrEqual(90);
    expect(elapsed).toBeLessThan(200);
  });

  it('should return a promise', () => {
    const result = sleep(10);
    expect(result).toBeInstanceOf(Promise);
  });
});

describe('retry', () => {
  it('should return value on first successful attempt', async () => {
    const fn = vi.fn(async () => 'success');
    const result = await retry(fn, 3, 100);
    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('should retry on failure and eventually succeed', async () => {
    let attempts = 0;
    const fn = vi.fn(async () => {
      attempts++;
      if (attempts < 3) throw new Error('fail');
      return 'success';
    });
    const result = await retry(fn, 5, 10);
    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('should throw after max attempts exceeded', async () => {
    const fn = vi.fn(async () => {
      throw new Error('always fails');
    });
    await expect(retry(fn, 2, 10)).rejects.toThrow('always fails');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('should use exponential backoff', async () => {
    const fn = vi.fn(async () => {
      throw new Error('fail');
    });
    const start = Date.now();
    await retry(fn, 3, 50).catch(() => {});
    const elapsed = Date.now() - start;
    // First attempt: 0ms
    // First retry after 50ms * 2^0 = 50ms
    // Second retry after 50ms * 2^1 = 100ms
    // Total: ~150ms minimum (with JS timer imprecision)
    expect(elapsed).toBeGreaterThanOrEqual(90);
  });

  it('should handle non-Error exceptions', async () => {
    const fn = vi.fn(async () => {
      throw 'string error';
    });
    await expect(retry(fn, 2, 10)).rejects.toThrow('string error');
  });

  it('should use default max attempts of 3', async () => {
    const fn = vi.fn(async () => {
      throw new Error('fail');
    });
    await retry(fn, undefined, 10).catch(() => {});
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('should use default base delay of 1000ms', async () => {
    const fn = vi.fn(async () => {
      throw new Error('fail');
    });
    const start = Date.now();
    await retry(fn, 2, undefined).catch(() => {});
    const elapsed = Date.now() - start;
    // 1000ms * (2^0) = 1000ms
    expect(elapsed).toBeGreaterThanOrEqual(900);
  });
});

describe('formatPrice', () => {
  it('should format number with default 6 decimals', () => {
    expect(formatPrice(123.456789)).toBe('123.456789');
  });

  it('should format string to number then to decimals', () => {
    expect(formatPrice('123.456789')).toBe('123.456789');
  });

  it('should remove trailing zeros', () => {
    expect(formatPrice(123.4)).toBe('123.4');
    expect(formatPrice(123)).toBe('123');
  });

  it('should handle custom decimal places', () => {
    expect(formatPrice(123.456789, 2)).toBe('123.46');
    expect(formatPrice(123.456789, 4)).toBe('123.4568');
  });

  it('should return 0 for zero input', () => {
    expect(formatPrice(0)).toBe('0');
    expect(formatPrice('0')).toBe('0');
  });

  it('should handle very small numbers', () => {
    expect(formatPrice(0.000001)).toBe('0.000001');
  });

  it('should handle very large numbers', () => {
    const result = formatPrice('1000000.123456');
    expect(result).toContain('1000000');
  });

  it('should remove trailing decimal point', () => {
    // 100.00 should become "100" not "100."
    expect(formatPrice(100)).toBe('100');
  });
});

describe('percentChange', () => {
  it('should calculate positive percent change', () => {
    expect(percentChange(100, 150)).toBe(50); // 50% increase
  });

  it('should calculate negative percent change', () => {
    expect(percentChange(100, 50)).toBe(-50); // 50% decrease
  });

  it('should return 0 when from equals to', () => {
    expect(percentChange(100, 100)).toBe(0);
  });

  it('should return 0 when from is zero', () => {
    expect(percentChange(0, 100)).toBe(0);
  });

  it('should handle string inputs', () => {
    expect(percentChange('100', '150')).toBe(50);
    expect(percentChange('100', '50')).toBe(-50);
  });

  it('should handle decimal values', () => {
    const result = percentChange(1.5, 1.65);
    expect(result).toBeCloseTo(10, 1); // 10% increase (with floating point tolerance)
  });

  it('should handle small decimal changes', () => {
    const result = percentChange(1000, 1010);
    expect(result).toBe(1); // 1% increase
  });
});

describe('formatUsdc', () => {
  it('should format number as USDC currency', () => {
    expect(formatUsdc(1000)).toBe('$1,000.00');
  });

  it('should format string as USDC currency', () => {
    expect(formatUsdc('1000')).toBe('$1,000.00');
  });

  it('should handle thousands with commas', () => {
    expect(formatUsdc(1000000)).toBe('$1,000,000.00');
  });

  it('should always show 2 decimal places', () => {
    expect(formatUsdc(100)).toBe('$100.00');
    expect(formatUsdc('100.5')).toBe('$100.50');
  });

  it('should handle small amounts', () => {
    expect(formatUsdc(0.01)).toBe('$0.01');
    expect(formatUsdc(0.5)).toBe('$0.50');
  });

  it('should handle zero', () => {
    expect(formatUsdc(0)).toBe('$0.00');
  });
});

describe('generateId', () => {
  it('should generate unique IDs', () => {
    const id1 = generateId();
    const id2 = generateId();
    expect(id1).not.toBe(id2);
  });

  it('should include prefix when provided', () => {
    const id = generateId('order');
    expect(id).toMatch(/^order_/);
  });

  it('should not include prefix when not provided', () => {
    const id = generateId();
    expect(id).not.toMatch(/^_/);
  });

  it('should have predictable format with prefix', () => {
    const id = generateId('test');
    // Format: "prefix_timestamp_random"
    expect(id).toMatch(/^test_[a-z0-9]+_[a-z0-9]+$/);
  });

  it('should have predictable format without prefix', () => {
    const id = generateId();
    // Format: "timestamp_random"
    expect(id).toMatch(/^[a-z0-9]+_[a-z0-9]+$/);
  });

  it('should generate IDs of reasonable length', () => {
    const id = generateId('prefix');
    expect(id.length).toBeGreaterThan(10);
    expect(id.length).toBeLessThan(50);
  });
});

describe('clamp', () => {
  it('should return value when within range', () => {
    expect(clamp(50, 0, 100)).toBe(50);
  });

  it('should clamp to min when value is below min', () => {
    expect(clamp(-10, 0, 100)).toBe(0);
  });

  it('should clamp to max when value is above max', () => {
    expect(clamp(150, 0, 100)).toBe(100);
  });

  it('should handle negative ranges', () => {
    expect(clamp(-50, -100, -10)).toBe(-50);
  });

  it('should handle decimal values', () => {
    expect(clamp(0.5, 0.1, 0.9)).toBe(0.5);
    expect(clamp(0.05, 0.1, 0.9)).toBe(0.1);
  });

  it('should handle equal min and max', () => {
    expect(clamp(50, 100, 100)).toBe(100);
  });

  it('should handle zero boundaries', () => {
    expect(clamp(50, 0, 0)).toBe(0);
  });
});

describe('safeParseFloat', () => {
  it('should parse valid decimal string', () => {
    expect(safeParseFloat('123.45')).toBe(123.45);
  });

  it('should parse integer string', () => {
    expect(safeParseFloat('100')).toBe(100);
  });

  it('should return 0 for non-numeric string', () => {
    expect(safeParseFloat('abc')).toBe(0);
  });

  it('should return 0 for empty string', () => {
    expect(safeParseFloat('')).toBe(0);
  });

  it('should handle whitespace', () => {
    expect(safeParseFloat('  123.45  ')).toBe(123.45);
  });

  it('should parse scientific notation', () => {
    expect(safeParseFloat('1e3')).toBe(1000);
  });

  it('should return 0 for NaN', () => {
    expect(safeParseFloat('NaN')).toBe(0);
  });

  it('should handle negative numbers', () => {
    expect(safeParseFloat('-123.45')).toBe(-123.45);
  });

  it('should handle zero', () => {
    expect(safeParseFloat('0')).toBe(0);
  });

  it('should handle very small decimals', () => {
    expect(safeParseFloat('0.000001')).toBe(0.000001);
  });
});
