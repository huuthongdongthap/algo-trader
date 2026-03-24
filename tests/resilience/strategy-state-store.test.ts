import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { StrategyStateStore } from '../../src/resilience/strategy-state-store.js';

describe('StrategyStateStore', () => {
  let tempDir: string;
  let store: StrategyStateStore;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'strategy-state-test-'));
    store = new StrategyStateStore(tempDir);
  });

  afterEach(() => {
    store.stopPeriodicFlush();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('should round-trip save + load from memory buffer', () => {
    const state = { priceHistory: [1.5, 2.0], positions: 3 };
    store.save('test-strategy', state);
    const loaded = store.load('test-strategy');
    expect(loaded).toEqual(state);
  });

  it('should return null for nonexistent strategy', () => {
    const loaded = store.load('does-not-exist');
    expect(loaded).toBeNull();
  });

  it('should flush dirty entries to disk', () => {
    store.save('flush-test', { value: 42 });
    store.flush();
    const filePath = join(tempDir, 'flush-test.json');
    expect(existsSync(filePath)).toBe(true);
    const raw = JSON.parse(readFileSync(filePath, 'utf8'));
    expect(raw.strategyId).toBe('flush-test');
    expect(raw.state).toEqual({ value: 42 });
  });

  it('should load from disk after flush and new store instance', () => {
    store.save('disk-test', { data: 'hello' });
    store.flush();

    // Create a new store pointing at the same directory
    const store2 = new StrategyStateStore(tempDir);
    const loaded = store2.load('disk-test');
    expect(loaded).toEqual({ data: 'hello' });
  });

  it('should reject state older than 2 hours', () => {
    const filePath = join(tempDir, 'old-strategy.json');
    const oldEntry = {
      strategyId: 'old-strategy',
      state: { stale: true },
      savedAt: Date.now() - 3 * 60 * 60 * 1000, // 3 hours ago
      version: 1,
    };
    writeFileSync(filePath, JSON.stringify(oldEntry), 'utf8');

    const loaded = store.load('old-strategy');
    expect(loaded).toBeNull();
  });

  it('should delete state from memory and disk', () => {
    store.save('delete-me', { temp: true });
    store.flush();

    const filePath = join(tempDir, 'delete-me.json');
    expect(existsSync(filePath)).toBe(true);

    store.delete('delete-me');
    expect(existsSync(filePath)).toBe(false);
    expect(store.load('delete-me')).toBeNull();
  });

  it('should list saved strategy IDs from disk', () => {
    store.save('alpha', { a: 1 });
    store.save('beta', { b: 2 });
    store.flush();

    const ids = store.listSaved();
    expect(ids).toContain('alpha');
    expect(ids).toContain('beta');
    expect(ids).toHaveLength(2);
  });

  it('should start and stop periodic flush', () => {
    vi.useFakeTimers();
    try {
      const flushSpy = vi.spyOn(store, 'flush');

      store.startPeriodicFlush(1000);
      store.save('periodic-test', { x: 1 });

      vi.advanceTimersByTime(1000);
      expect(flushSpy).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(1000);
      expect(flushSpy).toHaveBeenCalledTimes(2);

      store.stopPeriodicFlush();
      vi.advanceTimersByTime(3000);
      expect(flushSpy).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('should flush and stop timer on shutdown', () => {
    vi.useFakeTimers();
    try {
      const flushSpy = vi.spyOn(store, 'flush');

      store.startPeriodicFlush(5000);
      store.save('shutdown-test', { y: 2 });

      store.shutdown();
      expect(flushSpy).toHaveBeenCalledTimes(1);

      // Timer should be stopped — no more flushes
      vi.advanceTimersByTime(10000);
      expect(flushSpy).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('should return null for corrupted JSON on disk', () => {
    const filePath = join(tempDir, 'corrupted.json');
    writeFileSync(filePath, '{not valid json!!!', 'utf8');

    const loaded = store.load('corrupted');
    expect(loaded).toBeNull();
  });

  it('should increment version on successive saves', () => {
    store.save('versioned', { v: 1 });
    store.save('versioned', { v: 2 });
    store.save('versioned', { v: 3 });
    store.flush();

    const filePath = join(tempDir, 'versioned.json');
    const raw = JSON.parse(readFileSync(filePath, 'utf8'));
    expect(raw.version).toBe(3);
    expect(raw.state).toEqual({ v: 3 });
  });
});
