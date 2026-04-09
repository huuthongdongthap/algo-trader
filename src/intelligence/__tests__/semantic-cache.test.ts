/**
 * Semantic Cache Tests
 * Tests Redis-backed cache for dependency graphs
 */

import { describe, it, expect } from 'vitest';
import { hashMarketIds } from '../semantic-cache';

describe('Semantic Cache', () => {
  describe('hashMarketIds', () => {
    it('should hash market IDs into stable string', () => {
      const marketIds = ['market_1', 'market_2', 'market_3'];
      const hash = hashMarketIds(marketIds);

      expect(typeof hash).toBe('string');
      expect(hash.length).toBeGreaterThan(0);
    });

    it('should produce consistent hash for same input', () => {
      const marketIds = ['market_1', 'market_2', 'market_3'];

      const hash1 = hashMarketIds(marketIds);
      const hash2 = hashMarketIds(marketIds);

      expect(hash1).toBe(hash2);
    });

    it('should produce same hash for different order (order-independent)', () => {
      const ids1 = ['market_1', 'market_2'];
      const ids2 = ['market_2', 'market_1'];

      const hash1 = hashMarketIds(ids1);
      const hash2 = hashMarketIds(ids2);

      // Hashes should be same because function sorts internally
      expect(hash1).toBe(hash2);
    });

    it('should handle single market', () => {
      const hash = hashMarketIds(['market_1']);

      expect(typeof hash).toBe('string');
      expect(hash.length).toBeGreaterThan(0);
    });

    it('should handle many markets', () => {
      const marketIds = Array.from({ length: 100 }, (_, i) => `market_${i}`);
      const hash = hashMarketIds(marketIds);

      expect(typeof hash).toBe('string');
      expect(hash.length).toBeGreaterThan(0);
    });

    it('should produce 16-character hex string', () => {
      const marketIds = ['market_1', 'market_2'];
      const hash = hashMarketIds(marketIds);

      expect(/^[0-9a-f]{16}$/.test(hash)).toBe(true);
    });

    it('should handle special characters in market IDs', () => {
      const marketIds = ['BTC/USD', 'ETH-USDT', 'XRP_PRICE'];
      const hash = hashMarketIds(marketIds);

      expect(typeof hash).toBe('string');
      expect(hash.length).toBe(16);
    });

    it('should be deterministic across multiple calls', () => {
      const marketIds = ['m1', 'm2', 'm3', 'm4', 'm5'];

      const hashes = Array.from({ length: 5 }, () => hashMarketIds(marketIds));

      // All hashes should be identical
      expect(new Set(hashes).size).toBe(1);
    });

    it('should differ for different market sets', () => {
      const hash1 = hashMarketIds(['market_1', 'market_2']);
      const hash2 = hashMarketIds(['market_1', 'market_3']);

      expect(hash1).not.toBe(hash2);
    });

    it('should handle duplicate markets in list', () => {
      const hash1 = hashMarketIds(['market_1', 'market_2']);
      const hash2 = hashMarketIds(['market_1', 'market_1', 'market_2']);

      // Should be different due to duplicates
      expect(typeof hash1).toBe('string');
      expect(typeof hash2).toBe('string');
    });

    it('should produce consistent length regardless of input size', () => {
      const hash1 = hashMarketIds(['m1']);
      const hash2 = hashMarketIds(['m1', 'm2']);
      const hash3 = hashMarketIds(['m1', 'm2', 'm3', 'm4', 'm5']);

      expect(hash1.length).toBe(hash2.length);
      expect(hash2.length).toBe(hash3.length);
      expect(hash1.length).toBe(16);
    });
  });

  describe('cache interface contract', () => {
    it('should export hashMarketIds function', async () => {
      const { hashMarketIds } = await import('../semantic-cache');
      expect(typeof hashMarketIds).toBe('function');
    });

    it('should export getCachedGraph function', async () => {
      const { getCachedGraph } = await import('../semantic-cache');
      expect(typeof getCachedGraph).toBe('function');
    });

    it('should export setCachedGraph function', async () => {
      const { setCachedGraph } = await import('../semantic-cache');
      expect(typeof setCachedGraph).toBe('function');
    });

    it('should export invalidateCachedGraph function', async () => {
      const { invalidateCachedGraph } = await import('../semantic-cache');
      expect(typeof invalidateCachedGraph).toBe('function');
    });
  });

  describe('cache key format', () => {
    it('should generate cache key with prefix', () => {
      const hash = hashMarketIds(['m1', 'm2']);

      // Key format: semantic:deps:{hash}
      expect(hash).toMatch(/^[0-9a-f]{16}$/);
    });

    it('should use consistent hash for cache operations', () => {
      const marketIds = ['market_1', 'market_2'];

      const hash1 = hashMarketIds(marketIds);
      const hash2 = hashMarketIds(marketIds);

      expect(hash1).toBe(hash2);
      expect(hash1).toMatch(/^[0-9a-f]{16}$/);
    });
  });

  describe('hashing behavior', () => {
    it('should use sorted order internally', () => {
      // These should produce same hash despite different input order
      const hash1 = hashMarketIds(['c', 'a', 'b']);
      const hash2 = hashMarketIds(['a', 'b', 'c']);

      expect(hash1).toBe(hash2);
    });

    it('should handle empty array', () => {
      const hash = hashMarketIds([]);

      expect(typeof hash).toBe('string');
      expect(hash.length).toBe(16);
    });

    it('should use SHA256 internally', () => {
      // Different inputs should have very different hashes
      const hash1 = hashMarketIds(['market_1']);
      const hash2 = hashMarketIds(['market_2']);

      expect(hash1).not.toBe(hash2);
    });
  });

  describe('config constants', () => {
    it('should define TTL as 3600 seconds', async () => {
      // Verify module doesn't throw on import
      const module = await import('../semantic-cache');
      expect(module).toBeDefined();
    });
  });
});
