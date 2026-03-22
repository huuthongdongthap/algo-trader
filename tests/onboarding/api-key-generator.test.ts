import { describe, it, expect } from 'vitest';
import {
  generateApiKey,
  generateApiSecret,
  generateWebhookSecret,
  hashApiSecret,
} from '../../src/onboarding/api-key-generator.js';

describe('generateApiKey', () => {
  it('should return 32-character hex string', () => {
    const key = generateApiKey();
    expect(key).toHaveLength(32);
    expect(key).toMatch(/^[0-9a-f]{32}$/);
  });

  it('should generate unique keys', () => {
    const keys = new Set(Array.from({ length: 20 }, () => generateApiKey()));
    expect(keys.size).toBe(20);
  });
});

describe('generateApiSecret', () => {
  it('should return 64-character hex string', () => {
    const secret = generateApiSecret();
    expect(secret).toHaveLength(64);
    expect(secret).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('generateWebhookSecret', () => {
  it('should return 32-character hex string', () => {
    const secret = generateWebhookSecret();
    expect(secret).toHaveLength(32);
    expect(secret).toMatch(/^[0-9a-f]{32}$/);
  });
});

describe('hashApiSecret', () => {
  it('should return 64-character hex SHA-256 hash', () => {
    const hash = hashApiSecret('my-secret');
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('should produce consistent hash for same input', () => {
    const h1 = hashApiSecret('test');
    const h2 = hashApiSecret('test');
    expect(h1).toBe(h2);
  });

  it('should produce different hash for different input', () => {
    const h1 = hashApiSecret('secret-a');
    const h2 = hashApiSecret('secret-b');
    expect(h1).not.toBe(h2);
  });
});
