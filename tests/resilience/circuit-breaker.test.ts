import { describe, it, expect, vi } from 'vitest';
import {
  CircuitBreaker,
  CircuitOpenError,
} from '../../src/resilience/circuit-breaker.js';

describe('CircuitBreaker', () => {
  it('should start in closed state', () => {
    const cb = new CircuitBreaker({ failureThreshold: 3, resetTimeoutMs: 1000 });
    expect(cb.getStatus().state).toBe('closed');
    expect(cb.getStatus().failureCount).toBe(0);
  });

  it('should pass through successful calls', async () => {
    const cb = new CircuitBreaker({ failureThreshold: 3, resetTimeoutMs: 1000 });
    const result = await cb.execute(async () => 42);
    expect(result).toBe(42);
    expect(cb.getStatus().state).toBe('closed');
  });

  it('should count failures but stay closed below threshold', async () => {
    const cb = new CircuitBreaker({ failureThreshold: 3, resetTimeoutMs: 1000 });
    const fail = () => cb.execute(async () => { throw new Error('fail'); });

    await expect(fail()).rejects.toThrow('fail');
    await expect(fail()).rejects.toThrow('fail');
    expect(cb.getStatus().state).toBe('closed');
    expect(cb.getStatus().failureCount).toBe(2);
  });

  it('should open after reaching failure threshold', async () => {
    const cb = new CircuitBreaker({ failureThreshold: 2, resetTimeoutMs: 1000 });
    const fail = () => cb.execute(async () => { throw new Error('fail'); });

    await expect(fail()).rejects.toThrow('fail');
    await expect(fail()).rejects.toThrow('fail');
    expect(cb.getStatus().state).toBe('open');
  });

  it('should reject calls when open', async () => {
    const cb = new CircuitBreaker({ failureThreshold: 1, resetTimeoutMs: 100_000 });
    await expect(cb.execute(async () => { throw new Error('fail'); })).rejects.toThrow();
    await expect(cb.execute(async () => 'ok')).rejects.toThrow(CircuitOpenError);
  });

  it('should transition to half-open after reset timeout', async () => {
    const cb = new CircuitBreaker({ failureThreshold: 1, resetTimeoutMs: 50, name: 'test-cb' });
    await expect(cb.execute(async () => { throw new Error('fail'); })).rejects.toThrow();
    expect(cb.getStatus().state).toBe('open');

    // Wait for reset timeout
    await new Promise(r => setTimeout(r, 60));
    expect(cb.getStatus().state).toBe('half-open');
  });

  it('should close on success in half-open state', async () => {
    const cb = new CircuitBreaker({ failureThreshold: 1, resetTimeoutMs: 50 });
    await expect(cb.execute(async () => { throw new Error('fail'); })).rejects.toThrow();
    await new Promise(r => setTimeout(r, 60));

    const result = await cb.execute(async () => 'recovered');
    expect(result).toBe('recovered');
    expect(cb.getStatus().state).toBe('closed');
    expect(cb.getStatus().failureCount).toBe(0);
  });

  it('should reopen on failure in half-open state', async () => {
    const cb = new CircuitBreaker({ failureThreshold: 1, resetTimeoutMs: 50 });
    await expect(cb.execute(async () => { throw new Error('fail'); })).rejects.toThrow();
    await new Promise(r => setTimeout(r, 60));

    await expect(cb.execute(async () => { throw new Error('still broken'); })).rejects.toThrow();
    expect(cb.getStatus().state).toBe('open');
  });

  it('should limit half-open attempts', async () => {
    const cb = new CircuitBreaker({
      failureThreshold: 1, resetTimeoutMs: 50, halfOpenMaxAttempts: 1,
    });
    await expect(cb.execute(async () => { throw new Error('fail'); })).rejects.toThrow();
    await new Promise(r => setTimeout(r, 60));

    // First half-open attempt (succeeds or fails, either counts)
    await expect(cb.execute(async () => { throw new Error('fail'); })).rejects.toThrow();
    // Second attempt should be rejected
    expect(cb.getStatus().state).toBe('open');
  });

  it('should invoke onStateChange callback', async () => {
    const transitions: string[] = [];
    const cb = new CircuitBreaker({
      failureThreshold: 1,
      resetTimeoutMs: 1000,
      onStateChange: (prev, next) => transitions.push(`${prev}→${next}`),
    });
    await expect(cb.execute(async () => { throw new Error('fail'); })).rejects.toThrow();
    expect(transitions).toContain('closed→open');
  });

  it('should reset manually', async () => {
    const cb = new CircuitBreaker({ failureThreshold: 1, resetTimeoutMs: 100_000 });
    await expect(cb.execute(async () => { throw new Error('fail'); })).rejects.toThrow();
    expect(cb.getStatus().state).toBe('open');

    cb.reset();
    expect(cb.getStatus().state).toBe('closed');
    expect(cb.getStatus().failureCount).toBe(0);
  });

  it('should partially reset failure count on success in closed state', async () => {
    const cb = new CircuitBreaker({ failureThreshold: 5, resetTimeoutMs: 1000 });
    // 3 failures
    for (let i = 0; i < 3; i++) {
      await expect(cb.execute(async () => { throw new Error('fail'); })).rejects.toThrow();
    }
    expect(cb.getStatus().failureCount).toBe(3);
    // 1 success reduces count by 1
    await cb.execute(async () => 'ok');
    expect(cb.getStatus().failureCount).toBe(2);
  });
});
