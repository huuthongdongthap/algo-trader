# Tester Memory - algo-trade

## Project Testing Patterns

- **Test Framework**: Vitest with describe/it syntax
- **Module System**: TypeScript ESM with .js extensions required in imports
- **Mocking**: Use vi.fn() for spies, beforeEach() for test isolation
- **HTTP Mocking**: Create mock ServerResponse with writeHead/end spies, IncomingMessage with headers
- **Stream Testing**: Use Node Readable for POST body simulation in tests

## API Routes Testing Convention

- **Route Handler Pattern**: `handleXxxRoutes(req, res, pathname, method): Promise<boolean>`
- **Setter Pattern**: `setXxxService(service)` for module-level singleton setup
- **Error Codes**: Return true (matched) + error code even for bad requests (400/404/500)
- **Route Matching**: Return false only when path not matched, true when handled (success or error)
- **Lazy Init**: Routes use getFeed()/getHandler() internal functions for default initialization

## Test File Structure

- File per route group (portfolio-routes.test.ts, signal-routes.test.ts, etc.)
- Organize by `describe()` blocks: one per route or feature area
- Mock data should reflect realistic values (equity > 0, win rates 0-1, etc.)
- Test both happy path and error scenarios with separate describe blocks

## Coverage Targets by Route Type

- **Route Matching**: Test exact paths, unmatched variations, typos, case sensitivity
- **HTTP Methods**: Test GET/POST with wrong methods returning 405/400 as appropriate
- **Error Handling**: Test missing params (400), not found (404), service errors (500/503)
- **Response Structure**: Verify nested objects, arrays, required fields
- **Initialization**: Test setters, lazy init patterns, handler reuse/memoization

## Test Count Guideline

- 10-12 tests per file is target, but scope determines final count
- portfolio-routes: 17 tests (comprehensive route coverage)
- signal-routes: 19 tests (error scenarios + analysis flow)
- docs-routes: 34 tests (extensive edge case coverage for path remapping)
