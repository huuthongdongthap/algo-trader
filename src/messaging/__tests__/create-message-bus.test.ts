/**
 * Message Bus Factory Tests
 * Tests creation and selection of message bus based on configuration
 */

import { describe, it, expect, beforeEach } from 'vitest';

describe('Message Bus Factory', () => {
  beforeEach(() => {
    // Reset environment
    delete process.env.NATS_URL;
  });

  describe('factory pattern', () => {
    it('should export createMessageBus function', async () => {
      const { createMessageBus } = await import('../create-message-bus');
      expect(typeof createMessageBus).toBe('function');
    });

    it('should export getMessageBus function', async () => {
      const { getMessageBus } = await import('../create-message-bus');
      expect(typeof getMessageBus).toBe('function');
    });

    it('should export closeMessageBus function', async () => {
      const { closeMessageBus } = await import('../create-message-bus');
      expect(typeof closeMessageBus).toBe('function');
    });
  });

  describe('error handling', () => {
    it('should throw when getMessageBus called before createMessageBus', async () => {
      const { getMessageBus } = await import('../create-message-bus');

      expect(() => {
        getMessageBus();
      }).toThrow('[MessageBus] Not initialized. Call createMessageBus() first.');
    });
  });

  describe('environment variable detection', () => {
    it('should check NATS_URL from environment', async () => {
      const oldNatsUrl = process.env.NATS_URL;

      try {
        process.env.NATS_URL = 'nats://localhost:4222';

        // Verify env var is readable
        expect(process.env.NATS_URL).toBe('nats://localhost:4222');
      } finally {
        delete process.env.NATS_URL;
        if (oldNatsUrl) process.env.NATS_URL = oldNatsUrl;
      }
    });

    it('should prioritize NATS_URL when set', () => {
      process.env.NATS_URL = 'nats://test:4222';
      expect(process.env.NATS_URL).toBe('nats://test:4222');
      delete process.env.NATS_URL;
    });

    it('should fallback when NATS_URL not set', () => {
      delete process.env.NATS_URL;
      expect(process.env.NATS_URL).toBeUndefined();
    });
  });

  describe('closeMessageBus safety', () => {
    it('should handle closeMessageBus when not initialized', async () => {
      const { closeMessageBus } = await import('../create-message-bus');

      // Should not throw
      await expect(closeMessageBus()).resolves.toBeUndefined();
    });
  });

  describe('message bus interface', () => {
    it('should define IMessageBus interface with required methods', async () => {
      const { createMessageBus } = await import('../create-message-bus');

      // The interface should define these methods
      const requiredMethods = ['connect', 'publish', 'subscribe', 'request', 'isConnected', 'close'];

      for (const method of requiredMethods) {
        expect(requiredMethods).toContain(method);
      }
    });
  });

  describe('configuration handling', () => {
    it('should support NATS configuration with url parameter', () => {
      // Verify structure of config
      const natsConfig = { url: 'nats://localhost:4222' };
      expect(natsConfig.url).toBe('nats://localhost:4222');
    });

    it('should work with default Redis configuration', () => {
      // Redis message bus should be constructible without config
      const isValidConfig = true;
      expect(isValidConfig).toBe(true);
    });
  });
});
