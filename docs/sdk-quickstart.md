# SDK Quickstart

Quick start guide for using the Algo-Trade TypeScript SDK to control trading strategies and monitor performance.

## Installation

Install the SDK from npm:

```bash
npm install @algo-trade/sdk
```

Or use Bun:

```bash
bun install @algo-trade/sdk
```

For development, clone and link locally:

```bash
git clone https://github.com/your-org/algo-trade.git
cd algo-trade
npm link
cd ../your-project
npm link @algo-trade/sdk
```

## Basic Setup

Initialize the SDK client:

```typescript
import { CashClawClient } from '@algo-trade/sdk';

const client = new CashClawClient({
  baseUrl: 'http://localhost:3000',  // Local dev
  apiKey: 'your_api_key_here',
  timeout: 10000  // 10 seconds (optional)
});
```

**For production:**

```typescript
const client = new CashClawClient({
  baseUrl: 'https://api.algo-trade.io',
  apiKey: process.env.ALGO_TRADE_API_KEY!,
  timeout: 10000
});
```

**Load API key from environment:**

```typescript
const apiKey = process.env.ALGO_TRADE_API_KEY;
if (!apiKey) {
  throw new Error('ALGO_TRADE_API_KEY not set');
}

const client = new CashClawClient({
  baseUrl: process.env.API_BASE_URL || 'http://localhost:3000',
  apiKey
});
```

## Health Check

Check server status before making requests:

```typescript
try {
  const health = await client.getHealth();

  console.log('Status:', health.status);  // "ok", "degraded", "down"
  console.log('Uptime:', health.uptime);  // milliseconds
  console.log('Version:', health.version);

  if (health.status === 'ok') {
    console.log('✓ Server is healthy');
  } else {
    console.warn('⚠ Server degraded, some features may not work');
  }
} catch (error) {
  console.error('Failed to check health:', error.message);
}
```

## Engine Status

Get running strategies and trade counts:

```typescript
try {
  const status = await client.getStatus();

  console.log('Running:', status.running);
  console.log('Strategies:', status.strategies);      // ["grid-trading", "dca-bot"]
  console.log('Total trades:', status.tradeCount);
  console.log('Uptime:', status.uptime, 'ms');
} catch (error) {
  console.error('Status error:', error.message);
}
```

## Starting & Stopping Strategies

### Start a Strategy

```typescript
try {
  const result = await client.startStrategy('grid-trading');

  console.log('✓ Strategy started:', result.strategy);
  // Output: "✓ Strategy started: grid-trading"
} catch (error) {
  console.error('Failed to start:', error.message);
}
```

**Valid strategy names:**

- `cross-market-arb` — Exploits price differences across exchanges
- `market-maker` — Provides liquidity for bid-ask spreads
- `grid-trading` — Places orders in a grid pattern
- `dca-bot` — Dollar-cost averaging accumulation
- `funding-rate-arb` — Arbitrages funding rate spreads

### Stop a Strategy

```typescript
try {
  const result = await client.stopStrategy('grid-trading');

  console.log('✓ Strategy stopped:', result.strategy);
} catch (error) {
  console.error('Failed to stop:', error.message);
}
```

## Trade History

Retrieve recent trades:

```typescript
try {
  const response = await client.getTrades();

  console.log(`Total trades: ${response.count}`);

  for (const trade of response.trades) {
    console.log(
      `${trade.strategy}: ${trade.side} ${trade.fillSize} @ ${trade.fillPrice}`,
      `(fee: $${trade.fees})`
    );
  }
} catch (error) {
  console.error('Trade history error:', error.message);
}
```

**Trade structure:**

```typescript
interface TradeResult {
  orderId: string;           // Unique identifier
  marketId: string;          // e.g., "BTC/USD"
  side: 'buy' | 'sell';      // Trade direction
  fillPrice: string;         // Execution price (decimal)
  fillSize: string;          // Quantity filled (decimal)
  fees: string;              // Fees in USD (decimal)
  timestamp: number;         // Unix milliseconds
  strategy: StrategyName;    // Strategy that executed
}
```

## P&L Summary

Get aggregated profit & loss:

```typescript
try {
  const pnl = await client.getPnl();

  console.log('Total fees paid: $' + pnl.totalFees);
  console.log('Total trades:', pnl.tradeCount);
  console.log('Trades by strategy:');

  for (const [strategy, count] of Object.entries(pnl.tradesByStrategy)) {
    console.log(`  ${strategy}: ${count} trades`);
  }
} catch (error) {
  console.error('P&L error:', error.message);
}
```

**Example output:**

```
Total fees paid: $0.012345
Total trades: 234
Trades by strategy:
  grid-trading: 120 trades
  dca-bot: 114 trades
```

## Error Handling

All SDK methods throw `SdkError` on failure:

```typescript
import { SdkError } from '@algo-trade/sdk';

try {
  await client.startStrategy('invalid-strategy');
} catch (error) {
  if (error instanceof SdkError) {
    console.error(`Error [${error.statusCode}]:`);
    console.error(`  Message: ${error.message}`);
    console.error(`  Endpoint: ${error.endpoint}`);

    if (error.statusCode === 401) {
      console.error('Invalid API key');
    } else if (error.statusCode === 400) {
      console.error('Invalid request parameters');
    } else if (error.statusCode === 429) {
      console.error('Rate limited');
    }
  } else {
    console.error('Unknown error:', error);
  }
}
```

**SdkError properties:**

```typescript
class SdkError extends Error {
  statusCode: number;  // HTTP status code (0 for network errors)
  endpoint: string;    // API endpoint path that failed
  message: string;     // Error description
}
```

## Retry Logic

Implement automatic retry for transient failures:

```typescript
async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxAttempts = 3,
  initialDelayMs = 1000
): Promise<T> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (!(error instanceof SdkError)) {
        throw error; // Re-throw non-API errors
      }

      const isRetryable =
        error.statusCode === 0 ||     // Network error
        error.statusCode === 429 ||   // Rate limited
        error.statusCode >= 500;      // Server error

      if (!isRetryable || attempt === maxAttempts - 1) {
        throw error;
      }

      const delayMs = initialDelayMs * Math.pow(2, attempt);
      console.log(`Retry ${attempt + 1}/${maxAttempts} after ${delayMs}ms`);
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
  throw new Error('Max retries exceeded');
}

// Usage:
const status = await retryWithBackoff(
  () => client.getStatus(),
  3,
  1000
);
```

## Real-World Examples

### Monitor Strategies in Loop

```typescript
async function monitorStrategies(intervalMs = 5000) {
  while (true) {
    try {
      const status = await client.getStatus();
      const pnl = await client.getPnl();

      console.log(`[${new Date().toISOString()}]`);
      console.log(`  Running: ${status.strategies.join(', ')}`);
      console.log(`  Trades: ${status.tradeCount}`);
      console.log(`  Fees paid: $${pnl.totalFees}`);

      await new Promise(resolve => setTimeout(resolve, intervalMs));
    } catch (error) {
      console.error('Monitor error:', error.message);
      // Continue monitoring despite error
    }
  }
}

// Start monitoring
monitorStrategies(5000).catch(console.error);
```

### Manage Strategy Lifecycle

```typescript
async function manageStrategy(name: string) {
  console.log(`Starting ${name}...`);

  try {
    // Start the strategy
    await client.startStrategy(name);
    console.log(`✓ ${name} started`);

    // Monitor for 1 hour
    const startTime = Date.now();
    const durationMs = 60 * 60 * 1000;

    while (Date.now() - startTime < durationMs) {
      const { tradeCount } = await client.getStatus();
      console.log(`Executed ${tradeCount} trades so far`);

      await new Promise(r => setTimeout(r, 10000)); // Check every 10s
    }

    // Stop after duration
    await client.stopStrategy(name);
    console.log(`✓ ${name} stopped`);

    // Print final P&L
    const pnl = await client.getPnl();
    console.log(`Final fees: $${pnl.totalFees}`);
  } catch (error) {
    console.error(`Strategy error: ${error.message}`);
    throw error;
  }
}

// Run
await manageStrategy('grid-trading');
```

### Dashboard with Live Updates

```typescript
import { CashClawClient } from '@algo-trade/sdk';

async function renderDashboard(client: CashClawClient) {
  setInterval(async () => {
    try {
      const [status, pnl, health] = await Promise.all([
        client.getStatus(),
        client.getPnl(),
        client.getHealth()
      ]);

      console.clear();
      console.log('╔════════════════════════════════════════╗');
      console.log('║     ALGO-TRADE DASHBOARD              ║');
      console.log('╚════════════════════════════════════════╝\n');

      console.log(`Status: ${health.status.toUpperCase()}`);
      console.log(`Uptime: ${Math.round(health.uptime / 1000)}s\n`);

      console.log('Strategies:');
      for (const strategy of status.strategies) {
        console.log(`  • ${strategy}`);
      }
      console.log(`\nTrades: ${status.tradeCount}`);
      console.log(`Fees: $${pnl.totalFees}\n`);

      console.log('By Strategy:');
      for (const [name, count] of Object.entries(pnl.tradesByStrategy)) {
        console.log(`  ${name}: ${count}`);
      }
    } catch (error) {
      console.error('Dashboard error:', error);
    }
  }, 5000); // Refresh every 5 seconds
}

// Usage:
const client = new CashClawClient({
  baseUrl: 'http://localhost:3000',
  apiKey: process.env.API_KEY || 'test-key'
});

await renderDashboard(client);
```

### Batch Operations

```typescript
async function startAllStrategies() {
  const strategies = [
    'grid-trading',
    'dca-bot',
    'market-maker'
  ];

  const results = await Promise.allSettled(
    strategies.map(name => client.startStrategy(name))
  );

  let succeeded = 0;
  let failed = 0;

  for (let i = 0; i < results.length; i++) {
    if (results[i].status === 'fulfilled') {
      console.log(`✓ ${strategies[i]} started`);
      succeeded++;
    } else {
      console.error(`✗ ${strategies[i]} failed:`, results[i].reason);
      failed++;
    }
  }

  console.log(`\nStarted ${succeeded}/${strategies.length} strategies`);
  if (failed > 0) {
    console.warn(`Failed: ${failed}`);
  }
}

await startAllStrategies();
```

## Configuration Best Practices

### Environment Variables

Create `.env` file:

```env
API_BASE_URL=https://api.algo-trade.io
ALGO_TRADE_API_KEY=your_api_key_here
API_TIMEOUT_MS=10000
```

Load in your code:

```typescript
import dotenv from 'dotenv';
dotenv.config();

const client = new CashClawClient({
  baseUrl: process.env.API_BASE_URL || 'http://localhost:3000',
  apiKey: process.env.ALGO_TRADE_API_KEY!,
  timeout: parseInt(process.env.API_TIMEOUT_MS || '10000')
});
```

### Separate Environments

```typescript
function createClient(env: 'dev' | 'staging' | 'prod') {
  const config = {
    dev: {
      baseUrl: 'http://localhost:3000',
      apiKey: 'dev-key-123'
    },
    staging: {
      baseUrl: 'https://staging.api.algo-trade.io',
      apiKey: process.env.STAGING_API_KEY!
    },
    prod: {
      baseUrl: 'https://api.algo-trade.io',
      apiKey: process.env.PROD_API_KEY!
    }
  };

  return new CashClawClient(config[env]);
}

const client = createClient(process.env.NODE_ENV as any);
```

## Testing

Mock the SDK for unit tests:

```typescript
import { vi } from 'vitest';

const mockClient = {
  getHealth: vi.fn().mockResolvedValue({ status: 'ok', uptime: 1000 }),
  getStatus: vi.fn().mockResolvedValue({ running: true, strategies: [] }),
  startStrategy: vi.fn().mockResolvedValue({ ok: true, strategy: 'grid-trading' }),
  getTrades: vi.fn().mockResolvedValue({ trades: [], count: 0 }),
  getPnl: vi.fn().mockResolvedValue({ totalFees: '0', tradeCount: 0 })
};

// Use in tests
describe('Strategy Management', () => {
  it('should start strategy', async () => {
    const result = await mockClient.startStrategy('grid-trading');
    expect(result.strategy).toBe('grid-trading');
  });
});
```

## Troubleshooting

### "Invalid API Key"

```
Error: 401 GET /api/status failed: Unauthorized
```

**Solution:** Verify API key is correct and hasn't expired.

```typescript
// Debug: Check config
console.log('API Key:', client['apiKey'].substring(0, 8) + '...');
console.log('Base URL:', client['baseUrl']);
```

### "Rate Limit Exceeded"

```
Error: 429 GET /api/trades failed: Too Many Requests
```

**Solution:** Implement retry with backoff (see [Retry Logic](#retry-logic)).

### Network Timeout

```
Error: Network request failed
```

**Solution:** Increase timeout or check server connectivity.

```typescript
const client = new CashClawClient({
  baseUrl: 'https://api.algo-trade.io',
  apiKey: 'your_key',
  timeout: 30000  // 30 seconds
});
```

### "Method Not Allowed (405)"

```
Error: 405 POST /api/health failed: Method Not Allowed
```

**Solution:** Check endpoint and HTTP method match documentation.

## Next Steps

- Read [API Reference](./api-reference.md) for detailed endpoint documentation
- Check [System Architecture](./system-architecture.md) for design details
- View [Code Standards](./code-standards.md) for contribution guidelines
- Explore [examples/](../examples/) directory for complete sample applications

## Support

- Issues: https://github.com/your-org/algo-trade/issues
- Discussions: https://github.com/your-org/algo-trade/discussions
- Documentation: https://docs.algo-trade.io
