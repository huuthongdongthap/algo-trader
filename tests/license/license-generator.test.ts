// Tests for license-generator.ts — payload building, key generation, parsing, tier defaults
import { describe, it, expect } from 'vitest';
import {
  buildPayload,
  generateLicense,
  parseLicenseKey,
  getTierDefaults,
  toBase64Url,
  signHmac,
  type LicensePayload,
} from '../../src/license/license-generator.js';

const SECRET = 'generator-test-secret';
const NOW = Date.now();
const FUTURE = NOW + 7 * 24 * 60 * 60 * 1000;

describe('buildPayload', () => {
  it('should apply free tier defaults', () => {
    const p = buildPayload({ userId: 'u1', tier: 'free', issuedAt: NOW, expiresAt: FUTURE });
    expect(p.maxMarkets).toBe(1);
    expect(p.maxTradesPerDay).toBe(5);
    expect(p.features).toHaveLength(0);
    expect(p.userId).toBe('u1');
    expect(p.tier).toBe('free');
  });

  it('should apply pro tier defaults', () => {
    const p = buildPayload({ userId: 'u2', tier: 'pro', issuedAt: NOW, expiresAt: FUTURE });
    expect(p.maxMarkets).toBe(10);
    expect(p.maxTradesPerDay).toBe(-1);
    expect(p.features).toContain('backtesting');
    expect(p.features).toContain('multi-market');
  });

  it('should apply enterprise tier defaults', () => {
    const p = buildPayload({ userId: 'u3', tier: 'enterprise', issuedAt: NOW, expiresAt: FUTURE });
    expect(p.maxMarkets).toBe(-1);
    expect(p.maxTradesPerDay).toBe(-1);
    expect(p.features).toContain('optimizer');
    expect(p.features).toContain('webhook');
    expect(p.features).toContain('backtesting');
    expect(p.features).toContain('multi-market');
  });

  it('should override maxMarkets when provided', () => {
    const p = buildPayload({ userId: 'u4', tier: 'free', issuedAt: NOW, expiresAt: FUTURE, maxMarkets: 99 });
    expect(p.maxMarkets).toBe(99);
  });

  it('should override maxTradesPerDay when provided', () => {
    const p = buildPayload({ userId: 'u5', tier: 'free', issuedAt: NOW, expiresAt: FUTURE, maxTradesPerDay: 100 });
    expect(p.maxTradesPerDay).toBe(100);
  });

  it('should override features when provided', () => {
    const p = buildPayload({
      userId: 'u6', tier: 'free', issuedAt: NOW, expiresAt: FUTURE,
      features: ['backtesting'],
    });
    expect(p.features).toContain('backtesting');
  });

  it('should preserve issuedAt and expiresAt', () => {
    const p = buildPayload({ userId: 'u7', tier: 'pro', issuedAt: 1000, expiresAt: 2000 });
    expect(p.issuedAt).toBe(1000);
    expect(p.expiresAt).toBe(2000);
  });
});

describe('generateLicense', () => {
  it('should produce a key with exactly one dot separator', () => {
    const payload = buildPayload({ userId: 'u1', tier: 'pro', issuedAt: NOW, expiresAt: FUTURE });
    const key = generateLicense(payload, SECRET);
    const parts = key.split('.');
    expect(parts).toHaveLength(2);
    expect(parts[0].length).toBeGreaterThan(0);
    expect(parts[1].length).toBeGreaterThan(0);
  });

  it('should produce different keys for different secrets', () => {
    const payload = buildPayload({ userId: 'u1', tier: 'pro', issuedAt: NOW, expiresAt: FUTURE });
    const k1 = generateLicense(payload, 'secret-a');
    const k2 = generateLicense(payload, 'secret-b');
    expect(k1).not.toBe(k2);
  });

  it('should produce different keys for different users', () => {
    const p1 = buildPayload({ userId: 'alice', tier: 'pro', issuedAt: NOW, expiresAt: FUTURE });
    const p2 = buildPayload({ userId: 'bob', tier: 'pro', issuedAt: NOW, expiresAt: FUTURE });
    expect(generateLicense(p1, SECRET)).not.toBe(generateLicense(p2, SECRET));
  });

  it('should produce deterministic output for same input', () => {
    const payload = buildPayload({ userId: 'u1', tier: 'free', issuedAt: 1000, expiresAt: 2000 });
    expect(generateLicense(payload, SECRET)).toBe(generateLicense(payload, SECRET));
  });

  it('key payload part should be valid base64url (no +/= chars)', () => {
    const payload = buildPayload({ userId: 'u1', tier: 'enterprise', issuedAt: NOW, expiresAt: FUTURE });
    const key = generateLicense(payload, SECRET);
    const [payloadPart, sigPart] = key.split('.');
    expect(payloadPart).toMatch(/^[A-Za-z0-9\-_]+$/);
    expect(sigPart).toMatch(/^[A-Za-z0-9\-_]+$/);
  });
});

describe('parseLicenseKey', () => {
  it('should parse payload from valid key', () => {
    const payload = buildPayload({ userId: 'u1', tier: 'pro', issuedAt: NOW, expiresAt: FUTURE });
    const key = generateLicense(payload, SECRET);
    const parsed = parseLicenseKey(key);
    expect(parsed).not.toBeNull();
    expect(parsed!.userId).toBe('u1');
    expect(parsed!.tier).toBe('pro');
    expect(parsed!.issuedAt).toBe(payload.issuedAt);
    expect(parsed!.expiresAt).toBe(payload.expiresAt);
  });

  it('should return null for key without dot', () => {
    expect(parseLicenseKey('nodothere')).toBeNull();
  });

  it('should return null for key with invalid base64url payload', () => {
    // last dot split — give invalid base64
    expect(parseLicenseKey('!!!invalid!!!.sig')).toBeNull();
  });

  it('should not verify signature (parse only)', () => {
    // parseLicenseKey must succeed even with wrong sig
    const payload = buildPayload({ userId: 'u1', tier: 'free', issuedAt: NOW, expiresAt: FUTURE });
    const key = generateLicense(payload, SECRET);
    const [payloadPart] = key.split('.');
    const withWrongSig = `${payloadPart}.invalidsig`;
    const parsed = parseLicenseKey(withWrongSig);
    expect(parsed).not.toBeNull();
    expect(parsed!.userId).toBe('u1');
  });
});

describe('getTierDefaults', () => {
  it('should return copy of free defaults', () => {
    const d = getTierDefaults('free');
    expect(d.maxMarkets).toBe(1);
    expect(d.maxTradesPerDay).toBe(5);
    expect(d.features).toHaveLength(0);
  });

  it('should return copy — mutations do not affect source', () => {
    const d = getTierDefaults('pro');
    d.maxMarkets = 999;
    const d2 = getTierDefaults('pro');
    expect(d2.maxMarkets).toBe(10); // original unchanged
  });

  it('should include webhook and optimizer features in enterprise', () => {
    const d = getTierDefaults('enterprise');
    expect(d.features).toContain('webhook');
    expect(d.features).toContain('optimizer');
    expect(d.features).toContain('multi-market');
  });
});

describe('toBase64Url / signHmac', () => {
  it('toBase64Url should produce url-safe characters only', () => {
    const result = toBase64Url(Buffer.from('hello world!@#$%^&*()'));
    expect(result).toMatch(/^[A-Za-z0-9\-_]+$/);
  });

  it('signHmac should produce consistent digest for same inputs', () => {
    const sig1 = signHmac('message', 'secret');
    const sig2 = signHmac('message', 'secret');
    expect(sig1.toString('hex')).toBe(sig2.toString('hex'));
  });

  it('signHmac should differ for different messages', () => {
    const s1 = signHmac('msg-a', 'secret');
    const s2 = signHmac('msg-b', 'secret');
    expect(s1.toString('hex')).not.toBe(s2.toString('hex'));
  });
});
