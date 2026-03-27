/**
 * E2E Smoke Tests — verifies health endpoint responds correctly
 * Uses API_URL env var, defaults to http://localhost:3000
 */

import { describe, it, expect } from 'vitest';

describe('E2E Smoke Tests', () => {
  it('should respond to health endpoint', async () => {
    const baseUrl = process.env.API_URL || 'http://localhost:3000';
    const res = await fetch(`${baseUrl}/api/health`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe('ok');
  });
});
