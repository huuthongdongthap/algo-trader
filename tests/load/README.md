# Load Tests — algo-trade

k6 load testing scripts for the algo-trade REST API and WebSocket server.

## Install k6

```bash
brew install k6
```

## Scripts

| File | Target | Default Load |
|---|---|---|
| `api-load-test.js` | REST API (port 3000) | 10 VUs, 30s |
| `ws-load-test.js` | WebSocket (port 3003) | 50 VUs, 45s |
| `scenarios.js` | Reusable scenario configs | — |

## Run Tests

### REST API

```bash
# Default (10 VUs, 30s against localhost)
k6 run tests/load/api-load-test.js

# Against remote server
k6 run -e BASE_URL=http://prod:3000 -e API_KEY=real-key tests/load/api-load-test.js
```

### WebSocket

```bash
# Default (50 concurrent connections against localhost:3003)
k6 run tests/load/ws-load-test.js

# Against remote server
k6 run -e WS_URL=ws://prod:3003 tests/load/ws-load-test.js
```

## Scenarios

Import scenario configs from `scenarios.js` to override default options:

```js
import { buildOptions } from './scenarios.js';

export const options = buildOptions('load'); // smoke | load | stress | spike
```

| Scenario | VUs | Duration | Purpose |
|---|---|---|---|
| `smoke` | 1 | 1m | Sanity check |
| `load` | 1→50 | 12m total | Normal traffic |
| `stress` | 1→100 | 10m | Find breaking point |
| `spike` | 1→200 (instant) | ~1m20s | Burst resilience |

## Thresholds

Both scripts fail if:
- `p(95)` response time > 200ms (API) / session > 35s (WS)
- Error rate > 5%

## View Results

### Terminal summary (default)
k6 prints a summary table after each run.

### Grafana + InfluxDB

```bash
# Stream metrics to InfluxDB
k6 run --out influxdb=http://localhost:8086/k6 tests/load/api-load-test.js
```

Then open the k6 dashboard in Grafana.

### k6 Cloud

```bash
k6 cloud tests/load/api-load-test.js
```

Requires a [k6 Cloud](https://app.k6.io) account and `k6 login cloud`.
