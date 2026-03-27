# Algo Trader Developer Guide

This comprehensive guide covers everything you need to know to develop, test, and contribute to the Algo Trader project.

## Table of Contents
- [Local Setup from Scratch](#local-setup-from-scratch)
- [Common Troubleshooting](#common-troubleshooting)
- [Testing Guide](#testing-guide)
- [Contribution Workflow](#contribution-workflow)
- [DX Metrics and Tracking](#dx-metrics-and-tracking)

## Local Setup from Scratch

### Prerequisites
- Node.js v20 or higher
- npm v9 or higher (or pnpm v8+)
- Git
- Redis (for local development with caching)
- PostgreSQL (optional, for database features)

### Step 1: Clone the Repository
```bash
git clone https://github.com/your-org/mekong-cli.git
cd mekong-cli/apps/algo-trader
```

### Step 2: Install Dependencies
```bash
# Using npm
npm install

# Or using pnpm (recommended)
pnpm install
```

### Step 3: Configure Environment
```bash
# Copy the example environment file
cp .env.example .env

# Edit .env with your configuration
# Required for live trading:
# - EXCHANGE_API_KEY and EXCHANGE_SECRET for your preferred exchanges
# - DATABASE_URL if using database features
# - REDIS_URL if using Redis caching

# For backtesting only, you can skip API keys
# The system will use mock data providers
```

### Step 4: Build the Project
```bash
# Build with TypeScript
npm run build

# Or build with caching for faster subsequent builds
npm run build:cached
```

### Step 5: Run Development Server
```bash
# Start in development mode
npm run dev

# Or run specific commands
npm run dev backtest              # Backtest without API keys
npm run dev arb:agi               # AGI arbitrage strategy (requires API keys)
```

### Step 6: Quick Start Wizard
For first-time setup, use the interactive wizard:
```bash
npm run setup         # Interactive setup wizard
npm run quickstart    # Demo backtest + system status
```

### Docker Setup (Alternative)
If you prefer containerized development:
```bash
# Build and start with Docker Compose
docker-compose up --build

# Or use the one-click script
./scripts/one-click-setup-and-start.sh
```

## Common Troubleshooting

### TypeScript Compilation Errors
**Issue**: `tsc` fails with type errors
**Solution**:
```bash
# Clear TypeScript cache
rm -rf .tsbuildinfo

# Reinstall dependencies
npm install

# Check for any: types that need proper typing
grep -r ": any" src/
```

### Missing Dependencies
**Issue**: `Cannot find module` errors
**Solution**:
```bash
# Clean install
rm -rf node_modules package-lock.json
npm install

# Or if using pnpm
rm -rf node_modules pnpm-lock.yaml
pnpm install
```

### API Key Issues
**Issue**: Authentication failures with exchanges
**Solution**:
1. Verify your API keys have the correct permissions (trading, reading)
2. Ensure your `.env` file is not committed to git
3. Check that keys are properly formatted (no extra spaces)
4. Test with a simple curl command first:
   ```bash
   curl -H "X-MBX-APIKEY: YOUR_API_KEY" https://api.binance.com/api/v3/account
   ```

### Redis Connection Issues
**Issue**: `Error: connect ECONNREFUSED 127.0.0.1:6379`
**Solution**:
```bash
# Start Redis locally
redis-server

# Or disable Redis in .env for development
REDIS_ENABLED=false
```

### Database Connection Issues
**Issue**: PostgreSQL connection errors
**Solution**:
1. Ensure PostgreSQL is running locally
2. Verify your `DATABASE_URL` in `.env`
3. Create the required database:
   ```sql
   CREATE DATABASE algo_trader_dev;
   ```
4. Run migrations if applicable

### PM2 Process Issues
**Issue**: Application not starting with PM2
**Solution**:
```bash
# Check PM2 logs
pm2 logs

# Restart with debug logging
pm2 restart ecosystem.config.js --update-env --env development

# List all PM2 processes
pm2 list
```

### Memory Issues During Build
**Issue**: Build process killed due to memory constraints
**Solution**:
```bash
# Increase Node.js memory limit
export NODE_OPTIONS="--max-old-space-size=4096"
npm run build

# Or use cached build
npm run build:cached
```

## Testing Guide

### Test Structure
- **Unit Tests**: `tests/unit/` - Individual function/component tests
- **Integration Tests**: `tests/integration/` - Multi-component interaction tests
- **Smoke Tests**: `tests/smoke/` - Basic functionality validation
- **E2E Tests**: `tests/e2e/` - End-to-end workflow tests

### Running Tests
```bash
# Run all tests
npm test

# Run tests with coverage
npm test -- --coverage

# Run specific test file
npm test -- tests/unit/core/BotEngine.test.ts

# Run tests matching pattern
npm test -- -t "BotEngine"

# Run tests in watch mode (development)
npm test -- --watch

# Run CI tests (same as GitHub Actions)
npm test -- --ci --forceExit
```

### Writing Tests
Follow these guidelines when writing tests:

#### Unit Tests
- Test individual functions in isolation
- Mock external dependencies
- Cover edge cases and error conditions
- Keep tests fast (< 100ms each)

Example:
```typescript
describe('BotEngine', () => {
  let botEngine: BotEngine;
  let mockExchangeClient: jest.Mocked<ExchangeClient>;

  beforeEach(() => {
    mockExchangeClient = createMockExchangeClient();
    botEngine = new BotEngine(mockExchangeClient);
  });

  test('should execute trade when signal is generated', async () => {
    // Arrange
    const signal = { action: 'BUY', pair: 'BTC/USDT' };

    // Act
    await botEngine.processSignal(signal);

    // Assert
    expect(mockExchangeClient.placeOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        symbol: 'BTC/USDT',
        side: 'buy'
      })
    );
  });
});
```

#### Integration Tests
- Test component interactions
- Use real dependencies where possible
- Focus on critical paths
- Include setup/teardown for test state

#### E2E Tests
- Test complete user workflows
- Use actual API calls (with test accounts)
- Include realistic delays and timeouts
- Test both success and failure scenarios

### Test Coverage Requirements
- **Core modules**: ≥ 90% coverage
- **Strategies**: ≥ 85% coverage
- **Utilities**: ≥ 80% coverage
- **Edge cases**: Must be covered

### Debugging Tests
```bash
# Run single test file with debugger
node --inspect-brk node_modules/.bin/jest tests/unit/core/BotEngine.test.ts

# Get detailed test output
npm test -- --verbose --detectOpenHandles

# Check for memory leaks in tests
npm test -- --logHeapUsage
```

## Contribution Workflow

### Branch Strategy
- **main/master**: Production-ready code
- **staging**: Pre-production testing
- **feature/***: New features (create from main)
- **fix/***: Bug fixes (create from main)
- **hotfix/***: Critical production fixes (create from main)

### Pull Request Process
1. **Create Feature Branch**
   ```bash
   git checkout main
   git pull origin main
   git checkout -b feature/your-feature-name
   ```

2. **Make Changes**
   - Follow code standards in `docs/code-standards.md`
   - Write tests for new functionality
   - Update documentation if needed
   - Keep commits focused and atomic

3. **Run Quality Checks**
   ```bash
   # Type check
   npm run typecheck

   # Lint
   npm run lint

   # Test
   npm test

   # Build
   npm run build
   ```

4. **Commit Guidelines**
   Use conventional commit format:
   - `feat: add new strategy`
   - `fix: resolve order execution bug`
   - `refactor: simplify risk management logic`
   - `docs: update developer guide`
   - `test: add integration tests for arbitrage`
   - `chore: update dependencies`

5. **Create Pull Request**
   - Target `main` branch
   - Include description of changes
   - Reference related issues
   - Assign appropriate reviewers

6. **Code Review**
   - Address all feedback promptly
   - Don't force push during review (use additional commits)
   - Ensure all CI checks pass
   - Get approval from at least one reviewer

7. **Merge and Deploy**
   - Squash merge for clean history
   - Delete feature branch after merge
   - Verify deployment to staging
   - Monitor production after release

### Code Standards
- **File Naming**: kebab-case (e.g., `rsi-sma-strategy.ts`)
- **File Size**: Keep under 200 lines
- **Type Safety**: No `any` types, strict TypeScript
- **Error Handling**: Try-catch with proper logging
- **Comments**: Document complex logic, not obvious code
- **Security**: Never commit secrets, validate inputs

### Documentation Updates
When making significant changes:
1. Update relevant docs in `docs/` directory
2. Update README if CLI commands change
3. Add examples for new features
4. Update architecture diagrams if structure changes

## DX Metrics and Tracking

### Development Experience Metrics
We track the following metrics to improve developer experience:

#### Build Performance
- **Cold Build Time**: Target < 30 seconds
- **Incremental Build Time**: Target < 5 seconds
- **Memory Usage**: Target < 2GB peak

#### Test Performance
- **Unit Test Runtime**: Target < 30 seconds total
- **Test Coverage**: Target ≥ 85% overall
- **Flaky Tests**: Target 0 flaky tests

#### Code Quality
- **Technical Debt**: Target 0 TODO/FIXME comments
- **Type Safety**: Target 0 `any` types
- **Code Duplication**: Target < 5% duplication

### Monitoring Tools

#### Build Metrics
```bash
# Measure build time
time npm run build

# Analyze bundle size
npm run analyze

# Check TypeScript performance
npx tsc --diagnostics
```

#### Test Metrics
```bash
# Generate coverage report
npm test -- --coverage --coverageReporters=html

# Check test performance
npm test -- --verbose --testResultsProcessor=jest-junit

# Identify slow tests
npm test -- --logHeapUsage --detectOpenHandles
```

#### Code Quality Metrics
```bash
# Check for technical debt
grep -r "TODO\|FIXME" src/

# Check for any types
grep -r ": any" src/ --include="*.ts" --include="*.tsx"

# Run linter with metrics
npm run lint -- --format json > lint-results.json
```

### Continuous Improvement
- **Weekly DX Reviews**: Team reviews metrics and addresses regressions
- **Quarterly Tool Updates**: Evaluate and upgrade development tools
- **Developer Feedback**: Regular surveys to identify pain points
- **Automation**: Automate repetitive tasks and quality checks

### Performance Baselines
Current performance baselines (as of latest measurement):

| Metric | Current | Target | Status |
|--------|---------|--------|--------|
| Cold Build | 22s | < 30s | ✅ |
| Incremental Build | 3s | < 5s | ✅ |
| Unit Tests | 28s | < 30s | ✅ |
| Test Coverage | 92% | ≥ 85% | ✅ |
| Bundle Size | 1.2MB | < 2MB | ✅ |

### Reporting Issues
If you encounter DX issues:
1. Check if issue exists in GitHub Issues
2. Create new issue with `[DX]` prefix
3. Include environment details (OS, Node version, etc.)
4. Provide steps to reproduce
5. Suggest potential solutions if possible

---

*This guide is maintained by the Algo Trader team. Please keep it updated as the project evolves.*