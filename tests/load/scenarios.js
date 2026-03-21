// Reusable k6 scenario configurations for algo-trade load tests
// Import in test files: import { smokeScenario, loadScenario, stressScenario, spikeScenario } from './scenarios.js'

/**
 * Smoke test — 1 VU for 1 minute, sanity check only.
 * Use to verify the test script runs without errors before real load.
 */
export const smokeScenario = {
  executor: 'constant-vus',
  vus: 1,
  duration: '1m',
};

/**
 * Load test — realistic traffic ramp-up.
 * Ramp 1 → 50 VUs over 5m, hold for 5m, ramp down over 2m.
 */
export const loadScenario = {
  executor: 'ramping-vus',
  startVUs: 1,
  stages: [
    { duration: '5m', target: 50 },  // ramp up
    { duration: '5m', target: 50 },  // hold steady
    { duration: '2m', target: 0 },   // ramp down
  ],
};

/**
 * Stress test — push beyond normal capacity.
 * Ramp 1 → 100 VUs over 10m to find breaking point.
 */
export const stressScenario = {
  executor: 'ramping-vus',
  startVUs: 1,
  stages: [
    { duration: '5m', target: 50 },   // ramp to normal
    { duration: '5m', target: 100 },  // push beyond
  ],
};

/**
 * Spike test — sudden burst of traffic.
 * Jump from 1 VU to 200 VUs instantly, hold for 1m, then drop.
 */
export const spikeScenario = {
  executor: 'ramping-vus',
  startVUs: 1,
  stages: [
    { duration: '10s', target: 200 }, // instant spike
    { duration: '1m', target: 200 },  // hold spike
    { duration: '10s', target: 1 },   // drop back
  ],
};

/**
 * Helper: build k6 options with a single named scenario.
 * Usage: export const options = buildOptions('load');
 *
 * @param {'smoke'|'load'|'stress'|'spike'} name
 * @returns {import('k6/options').Options}
 */
export function buildOptions(name) {
  const map = {
    smoke: smokeScenario,
    load: loadScenario,
    stress: stressScenario,
    spike: spikeScenario,
  };

  const scenario = map[name];
  if (!scenario) {
    throw new Error(`Unknown scenario: ${name}. Valid: ${Object.keys(map).join(', ')}`);
  }

  return {
    scenarios: {
      [name]: scenario,
    },
    thresholds: {
      http_req_duration: ['p(95)<500'],
      http_req_failed: ['rate<0.05'],
    },
  };
}
