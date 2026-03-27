import { describe, it, expect, vi } from 'vitest';

describe('Algo Trader', () => {
  it('should have correct version', async () => {
    vi.stubEnv('LICENSE_ACTIVATION_SECRET', 'test-secret-for-ci');
    vi.stubEnv('LICENSE_ENCRYPTION_KEY', '01234567890123456789012345678901');
    const { version } = await import('./index');
    expect(version).toBe('1.0.0');
    vi.unstubAllEnvs();
  });
});
