// Barrel export for algo-trade REST API module
export { createServer, stopServer } from './server.js';
export { validateApiKey } from './auth-middleware.js';
export {
  handleRequest,
  handleHealth,
  handleStatus,
  handleTrades,
  handlePnl,
  handleStrategyStart,
  handleStrategyStop,
} from './routes.js';
