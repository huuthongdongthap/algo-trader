import { describe, it, expect } from 'vitest';
import { generateGrid, generateRandomSample } from '../../src/optimizer/grid-search.js';

describe('generateGrid', () => {
  it('should return single empty object for no ranges', () => {
    const result = generateGrid([]);
    expect(result).toEqual([{}]);
  });

  it('should generate all values for single param', () => {
    const result = generateGrid([{ name: 'x', min: 1, max: 3, step: 1 }]);
    expect(result.length).toBe(3);
    expect(result[0].x).toBe(1);
    expect(result[1].x).toBe(2);
    expect(result[2].x).toBe(3);
  });

  it('should compute cartesian product for multiple params', () => {
    const result = generateGrid([
      { name: 'a', min: 1, max: 2, step: 1 },
      { name: 'b', min: 10, max: 20, step: 10 },
    ]);
    // 2 * 2 = 4 combinations
    expect(result.length).toBe(4);
    // Check all combos present
    const combos = result.map(r => `${r.a}-${r.b}`);
    expect(combos).toContain('1-10');
    expect(combos).toContain('1-20');
    expect(combos).toContain('2-10');
    expect(combos).toContain('2-20');
  });

  it('should handle float steps', () => {
    const result = generateGrid([{ name: 'x', min: 0, max: 1, step: 0.5 }]);
    expect(result.length).toBe(3); // 0, 0.5, 1.0
  });

  it('should cap at MAX_COMBINATIONS (1000)', () => {
    // 11 * 11 * 11 = 1331 > 1000
    const result = generateGrid([
      { name: 'a', min: 0, max: 10, step: 1 },
      { name: 'b', min: 0, max: 10, step: 1 },
      { name: 'c', min: 0, max: 10, step: 1 },
    ]);
    expect(result.length).toBeLessThanOrEqual(1000);
  });
});

describe('generateRandomSample', () => {
  it('should generate requested number of samples', () => {
    const result = generateRandomSample(
      [{ name: 'x', min: 0, max: 100, step: 1 }],
      10,
    );
    expect(result.length).toBe(10);
  });

  it('should produce values within range', () => {
    const result = generateRandomSample(
      [{ name: 'x', min: 5, max: 10, step: 1 }],
      50,
    );
    for (const r of result) {
      expect(r.x).toBeGreaterThanOrEqual(5);
      expect(r.x).toBeLessThanOrEqual(10);
    }
  });

  it('should respect step boundaries', () => {
    const result = generateRandomSample(
      [{ name: 'x', min: 0, max: 10, step: 5 }],
      20,
    );
    // Values should be 0, 5, or 10
    for (const r of result) {
      expect([0, 5, 10]).toContain(r.x);
    }
  });

  it('should handle multiple params', () => {
    const result = generateRandomSample([
      { name: 'a', min: 0, max: 1, step: 0.1 },
      { name: 'b', min: 100, max: 200, step: 10 },
    ], 5);
    expect(result.length).toBe(5);
    for (const r of result) {
      expect(r.a).toBeDefined();
      expect(r.b).toBeDefined();
    }
  });
});
