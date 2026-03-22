import { describe, it, expect } from 'vitest';
import {
  validatePlugin,
  validateStrategy,
  securityScan,
  validateAll,
  checkMethodSignatures,
} from '../../src/plugins/plugin-validator.js';

function validModule() {
  return {
    name: 'test-plugin',
    version: '1.0.0',
    description: 'A test plugin',
    createStrategy: () => ({
      start: () => {},
      stop: () => {},
      getStatus: () => ({ state: 'stopped' }),
    }),
  };
}

describe('checkMethodSignatures', () => {
  it('should return empty array when all methods exist', () => {
    const obj = { foo: () => {}, bar: () => {} };
    expect(checkMethodSignatures(obj, ['foo', 'bar'])).toEqual([]);
  });

  it('should report missing methods', () => {
    const errors = checkMethodSignatures({}, ['start', 'stop']);
    expect(errors).toHaveLength(2);
    expect(errors[0]).toContain('Missing method');
  });

  it('should report non-function properties', () => {
    const errors = checkMethodSignatures({ start: 42 }, ['start']);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('must be a function');
  });
});

describe('validatePlugin', () => {
  it('should accept a valid plugin module', () => {
    const result = validatePlugin(validModule());
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('should reject null', () => {
    const result = validatePlugin(null);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('non-null object');
  });

  it('should reject missing name', () => {
    const mod = { ...validModule(), name: '' };
    const result = validatePlugin(mod);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('name');
  });

  it('should reject missing version', () => {
    const mod = { ...validModule(), version: '' };
    const result = validatePlugin(mod);
    expect(result.valid).toBe(false);
  });

  it('should reject non-string description', () => {
    const mod = { ...validModule(), description: 123 };
    const result = validatePlugin(mod);
    expect(result.valid).toBe(false);
  });

  it('should reject non-function createStrategy', () => {
    const mod = { ...validModule(), createStrategy: 'not-a-fn' };
    const result = validatePlugin(mod);
    expect(result.valid).toBe(false);
  });
});

describe('validateStrategy', () => {
  it('should accept valid strategy with start/stop/getStatus', () => {
    const strategy = { start: () => {}, stop: () => {}, getStatus: () => ({}) };
    const result = validateStrategy(strategy);
    expect(result.valid).toBe(true);
  });

  it('should reject null strategy', () => {
    const result = validateStrategy(null);
    expect(result.valid).toBe(false);
  });

  it('should report missing methods', () => {
    const result = validateStrategy({ start: () => {} });
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });
});

describe('securityScan', () => {
  it('should pass clean module', () => {
    const result = securityScan(validModule());
    expect(result.valid).toBe(true);
  });

  it('should detect eval usage', () => {
    const mod = {
      ...validModule(),
      createStrategy: () => { eval('1+1'); },
    };
    const result = securityScan(mod as any);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('Security');
  });

  it('should detect fetch usage', () => {
    const mod = {
      ...validModule(),
      createStrategy: () => { fetch('http://evil.com'); },
    };
    const result = securityScan(mod as any);
    expect(result.valid).toBe(false);
  });
});

describe('validateAll', () => {
  it('should pass fully valid module', () => {
    const result = validateAll(validModule());
    expect(result.valid).toBe(true);
  });

  it('should fail on invalid shape', () => {
    const mod = { ...validModule(), name: '' };
    const result = validateAll(mod);
    expect(result.valid).toBe(false);
  });

  it('should fail when createStrategy throws', () => {
    const mod = {
      ...validModule(),
      createStrategy: () => { throw new Error('boom'); },
    };
    const result = validateAll(mod);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('threw');
  });

  it('should fail when strategy missing methods', () => {
    const mod = {
      ...validModule(),
      createStrategy: () => ({ start: () => {} }), // missing stop, getStatus
    };
    const result = validateAll(mod);
    expect(result.valid).toBe(false);
  });
});
