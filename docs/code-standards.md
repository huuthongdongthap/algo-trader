# Code Standards - Algo-Trade Platform

## Tech Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| Runtime | Bun | latest |
| Language | TypeScript | 5.x (strict mode) |
| CEX API | CCXT | latest |
| EVM | ethers.js | v6 |
| Solana | @solana/web3.js | latest |
| Database | better-sqlite3 | latest |
| CLI | Commander.js | latest |
| Testing | Vitest | latest |

## File Naming

- **kebab-case** for all `.ts` files: `risk-manager.ts`, `clob-client.ts`
- **Descriptive names** that self-document purpose
- **Max 200 lines** per file; split if exceeding
- **Barrel exports** via `index.ts` in each module directory

## TypeScript Standards

### Strict Mode
```json
{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitReturns": true,
    "exactOptionalPropertyTypes": true
  }
}
```

### Path Aliases
```json
{
  "paths": {
    "@core/*": ["src/core/*"],
    "@polymarket/*": ["src/polymarket/*"],
    "@cex/*": ["src/cex/*"],
    "@dex/*": ["src/dex/*"],
    "@strategies/*": ["src/strategies/*"],
    "@data/*": ["src/data/*"],
    "@cli/*": ["src/cli/*"]
  }
}
```

### Type Rules
- **No `any`** - use `unknown` + type guards instead
- **Monetary values**: Always `string` (avoid float precision issues)
- **Timestamps**: `number` (Unix ms)
- **IDs**: `string`
- Use `interface` for object shapes, `type` for unions/intersections
- Export all types from `src/core/types.ts`

## Code Style

### Functions
- Pure functions preferred (no side effects, testable)
- Async functions return `Promise<T>` explicitly
- Max 30 lines per function; extract helpers if longer
- Use early returns to reduce nesting

### Error Handling
- Always use try/catch for external API calls
- Custom error classes extending `Error`
- Structured error logging (include context: market, strategy, order)
- Never swallow errors silently

### Imports
- Group: 1) Node/Bun builtins, 2) external packages, 3) internal modules
- Use path aliases (`@core/`, `@polymarket/`, etc.)
- Named imports only (no `import *`)

## Naming Conventions

| Entity | Convention | Example |
|--------|-----------|---------|
| Files | kebab-case | `risk-manager.ts` |
| Classes | PascalCase | `RiskManager` |
| Functions | camelCase | `calculatePositionSize()` |
| Constants | UPPER_SNAKE | `MAX_DRAWDOWN_PERCENT` |
| Interfaces | PascalCase (no I prefix) | `Order`, `Position` |
| Type aliases | PascalCase | `OrderSide`, `StrategyStatus` |
| Enums | PascalCase members | `OrderStatus.Filled` |

## Git Conventions

### Commit Messages
```
feat: add cross-market arbitrage strategy
fix: correct Kelly Criterion edge case for 0% win rate
refactor: extract orderbook state to separate module
test: add risk manager unit tests
docs: update system architecture diagram
```

### Branch Naming
```
feat/polymarket-arb
fix/grid-trading-range-break
refactor/core-types
```

## Testing Standards

- **Unit tests**: Co-located in `tests/` mirror of `src/` structure
- **Naming**: `[module].test.ts`
- **Coverage**: >80% core, >60% strategies
- **No real API calls** in unit tests; mock all external services
- **Integration tests**: Can use testnet endpoints
- Test file mirrors source structure:
  ```
  src/core/risk-manager.ts → tests/core/risk-manager.test.ts
  ```

## Security

- API keys in `.env` only (never in code, never committed)
- `.env` in `.gitignore`
- Private keys: environment variables only
- No secrets in logs (mask sensitive fields)
- Rate limit compliance for all external APIs

## Performance

- WebSocket over REST polling for real-time data
- Prepared statements for SQLite queries
- In-memory caching for hot data (orderbooks, prices)
- Exponential backoff for retries (2s, 4s, 8s)
