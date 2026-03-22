import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadOpenClawConfig } from '../../src/openclaw/openclaw-config.js';

describe('loadOpenClawConfig', () => {
  const savedEnv: Record<string, string | undefined> = {};
  const envKeys = [
    'OPENCLAW_GATEWAY_URL', 'OPENCLAW_API_KEY',
    'OPENCLAW_MODEL_SIMPLE', 'OPENCLAW_MODEL_STANDARD', 'OPENCLAW_MODEL_COMPLEX',
    'OPENCLAW_TIMEOUT_MS',
  ];

  beforeEach(() => {
    for (const k of envKeys) {
      savedEnv[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const k of envKeys) {
      if (savedEnv[k] !== undefined) process.env[k] = savedEnv[k];
      else delete process.env[k];
    }
  });

  it('should return defaults when no env vars set', () => {
    const cfg = loadOpenClawConfig();
    expect(cfg.gatewayUrl).toBe('http://localhost:11434/v1');
    expect(cfg.routing.simple).toBe('llama3.1:8b');
    expect(cfg.routing.standard).toBe('deepseek-r1:32b');
    expect(cfg.routing.complex).toBe('deepseek-r1:70b');
    expect(cfg.timeout).toBe(60_000);
    expect(cfg.apiKey).toBeUndefined();
  });

  it('should use env vars when set', () => {
    process.env['OPENCLAW_GATEWAY_URL'] = 'https://ai.example.com/v1';
    process.env['OPENCLAW_API_KEY'] = 'sk-test-123';
    process.env['OPENCLAW_MODEL_SIMPLE'] = 'gpt-4o-mini';
    process.env['OPENCLAW_MODEL_STANDARD'] = 'gpt-4o';
    process.env['OPENCLAW_MODEL_COMPLEX'] = 'o1-pro';
    process.env['OPENCLAW_TIMEOUT_MS'] = '30000';

    const cfg = loadOpenClawConfig();
    expect(cfg.gatewayUrl).toBe('https://ai.example.com/v1');
    expect(cfg.apiKey).toBe('sk-test-123');
    expect(cfg.routing.simple).toBe('gpt-4o-mini');
    expect(cfg.routing.standard).toBe('gpt-4o');
    expect(cfg.routing.complex).toBe('o1-pro');
    expect(cfg.timeout).toBe(30_000);
  });

  it('should fallback to default timeout for invalid value', () => {
    process.env['OPENCLAW_TIMEOUT_MS'] = 'not-a-number';
    const cfg = loadOpenClawConfig();
    expect(cfg.timeout).toBe(60_000);
  });

  it('should not set apiKey when env var is empty', () => {
    // Empty string is falsy — apiKey should not be set
    process.env['OPENCLAW_API_KEY'] = '';
    const cfg = loadOpenClawConfig();
    expect(cfg.apiKey).toBeUndefined();
  });

  it('should allow partial env overrides', () => {
    process.env['OPENCLAW_MODEL_COMPLEX'] = 'claude-opus-4-6';
    const cfg = loadOpenClawConfig();
    expect(cfg.routing.complex).toBe('claude-opus-4-6');
    expect(cfg.routing.simple).toBe('llama3.1:8b'); // default
    expect(cfg.routing.standard).toBe('deepseek-r1:32b'); // default
  });
});
