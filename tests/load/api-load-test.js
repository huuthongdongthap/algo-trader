// k6 REST API load test for algo-trade platform
// Tests all authenticated and public endpoints under load
// Run: k6 run tests/load/api-load-test.js
// Run with env: k6 run -e BASE_URL=http://prod:3000 -e API_KEY=real-key tests/load/api-load-test.js

import http from 'k6/http';
import { check, sleep } from 'k6';

// ─── Config ───────────────────────────────────────────────────────────────────

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
const API_KEY = __ENV.API_KEY || 'test-key';

/** Default options: 10 VUs for 30 seconds */
export const options = {
  vus: 10,
  duration: '30s',
  thresholds: {
    // 95th percentile response time must be under 200ms
    http_req_duration: ['p(95)<200'],
    // Error rate must stay below 5%
    http_req_failed: ['rate<0.05'],
  },
};

// ─── Shared headers ───────────────────────────────────────────────────────────

const authHeaders = {
  'X-API-Key': API_KEY,
  'Content-Type': 'application/json',
};

// ─── Test scenarios ───────────────────────────────────────────────────────────

/**
 * GET /api/health — public, no auth required.
 * Checks server liveness and uptime field.
 */
function testHealth() {
  const res = http.get(`${BASE_URL}/api/health`);
  check(res, {
    'health: status 200': (r) => r.status === 200,
    'health: response time < 200ms': (r) => r.timings.duration < 200,
    'health: has uptime field': (r) => JSON.parse(r.body).uptime !== undefined,
  });
}

/**
 * GET /api/status — requires X-API-Key header.
 * Checks engine status response shape.
 */
function testStatus() {
  const res = http.get(`${BASE_URL}/api/status`, { headers: authHeaders });
  check(res, {
    'status: status 200': (r) => r.status === 200,
    'status: response time < 200ms': (r) => r.timings.duration < 200,
  });
}

/**
 * GET /api/trades — recent trade log (last 100 trades).
 */
function testTrades() {
  const res = http.get(`${BASE_URL}/api/trades`, { headers: authHeaders });
  check(res, {
    'trades: status 200': (r) => r.status === 200,
    'trades: response time < 200ms': (r) => r.timings.duration < 200,
    'trades: has count field': (r) => JSON.parse(r.body).count !== undefined,
  });
}

/**
 * POST /api/strategy/start — start a named strategy.
 * Uses 'cross-market-arb' as the test strategy.
 */
function testStrategyStart() {
  const payload = JSON.stringify({ name: 'cross-market-arb' });
  const res = http.post(`${BASE_URL}/api/strategy/start`, payload, { headers: authHeaders });
  check(res, {
    'strategy/start: status 200 or 500': (r) => r.status === 200 || r.status === 500,
    'strategy/start: response time < 200ms': (r) => r.timings.duration < 200,
  });
}

// ─── Default function (executed per VU iteration) ─────────────────────────────

export default function () {
  testHealth();
  sleep(0.2);

  testStatus();
  sleep(0.2);

  testTrades();
  sleep(0.2);

  testStrategyStart();
  sleep(0.5);
}
